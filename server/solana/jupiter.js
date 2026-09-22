import { fetchJson, withRetry } from '../util/retry.js';
import { wallet, WSOL_MINT } from './wallet.js';
import { createLogger } from '../logger.js';

const log = createLogger('jupiter');
// Surchargeable : Jupiter fait tourner ses endpoints (lite-api, quote-api, pro).
const BASE = process.env.JUPITER_API || 'https://lite-api.jup.ag/swap/v1';

/**
 * Devis d'échange via l'agrégateur Jupiter : il compare tous les DEX Solana
 * et renvoie la meilleure route. `slippageBps` en points de base (100 = 1 %).
 */
export async function quote({ inputMint, outputMint, amount, slippageBps = 300 }) {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: String(Math.floor(amount)),
    slippageBps: String(slippageBps),
    // Les routes directes échouent moins souvent sur les tokens très récents.
    onlyDirectRoutes: 'false',
  });
  return withRetry(() => fetchJson(`${BASE}/quote?${params}`, { timeout: 12_000 }), {
    attempts: 2,
    onRetry: (err) => log.warn('devis retenté:', err.message),
  });
}

/** Construit la transaction de swap correspondant à un devis. */
export async function buildSwap(quoteResponse, { priorityLamports = 200_000 } = {}) {
  if (!wallet.canTrade) throw new Error('wallet Solana non connecté');
  const body = await fetchJson(`${BASE}/swap`, {
    method: 'POST',
    timeout: 20_000,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      // Sans frais de priorité, la transaction arrive trop tard sur un
      // nouveau token : le prix a déjà bougé.
      prioritizationFeeLamports: priorityLamports,
    }),
  });
  if (!body?.swapTransaction) throw new Error('Jupiter n\'a pas renvoyé de transaction');
  return body.swapTransaction;
}

/** Achat : SOL → token. `solAmount` en SOL. */
export async function buyToken({ mint, solAmount, slippageBps = 300 }) {
  const lamports = Math.floor(solAmount * 1e9);
  const q = await quote({
    inputMint: WSOL_MINT,
    outputMint: mint,
    amount: lamports,
    slippageBps,
  });
  const tx = await buildSwap(q);
  const signature = await wallet.signAndSend(tx);
  return {
    signature,
    inAmount: Number(q.inAmount) / 1e9,
    outAmount: Number(q.outAmount),
    priceImpactPct: Number(q.priceImpactPct ?? 0) * 100,
    route: q.routePlan?.map((r) => r.swapInfo?.label).filter(Boolean) ?? [],
  };
}

/** Vente : token → SOL. `rawAmount` en unités brutes (décimales incluses). */
export async function sellToken({ mint, rawAmount, slippageBps = 500 }) {
  const q = await quote({
    inputMint: mint,
    outputMint: WSOL_MINT,
    amount: rawAmount,
    slippageBps,
  });
  const tx = await buildSwap(q);
  const signature = await wallet.signAndSend(tx);
  return {
    signature,
    inAmount: Number(q.inAmount),
    outAmount: Number(q.outAmount) / 1e9,
    priceImpactPct: Number(q.priceImpactPct ?? 0) * 100,
  };
}

/**
 * Simule un achat sans l'exécuter : sert à vérifier qu'une route existe et
 * que l'impact prix est acceptable avant d'engager quoi que ce soit.
 */
export async function dryRunBuy({ mint, solAmount, slippageBps = 300 }) {
  const q = await quote({
    inputMint: WSOL_MINT,
    outputMint: mint,
    amount: Math.floor(solAmount * 1e9),
    slippageBps,
  });
  return {
    routable: true,
    outAmount: Number(q.outAmount),
    priceImpactPct: Number(q.priceImpactPct ?? 0) * 100,
    route: q.routePlan?.map((r) => r.swapInfo?.label).filter(Boolean) ?? [],
  };
}
