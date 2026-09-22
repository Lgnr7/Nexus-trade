import { fetchJson, withRetry } from '../util/retry.js';
import { createLogger } from '../logger.js';

const log = createLogger('dexscreener');
const BASE = 'https://api.dexscreener.com';

const get = (url) =>
  withRetry(() => fetchJson(url, { timeout: 15_000, headers: { accept: 'application/json' } }), {
    attempts: 2,
    onRetry: (err) => log.warn('retry:', err.message),
  });

/**
 * Sources de découverte des nouveaux tokens. On combine les profils récents
 * et les tokens « boostés » : les deux flux se recoupent peu et un token
 * intéressant apparaît souvent dans l'un avant l'autre.
 */
export async function discoverSolanaTokens() {
  const addresses = new Set();

  const sources = await Promise.allSettled([
    get(`${BASE}/token-profiles/latest/v1`),
    get(`${BASE}/token-boosts/latest/v1`),
  ]);

  for (const source of sources) {
    if (source.status !== 'fulfilled') {
      log.warn('source indisponible:', source.reason?.message);
      continue;
    }
    const items = Array.isArray(source.value) ? source.value : [];
    for (const item of items) {
      if (item?.chainId === 'solana' && item?.tokenAddress) addresses.add(item.tokenAddress);
    }
  }

  return [...addresses];
}

/** Détail des paires pour une liste d'adresses (30 max par requête DexScreener). */
export async function fetchPairs(addresses) {
  const out = [];
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30);
    try {
      const body = await get(`${BASE}/latest/dex/tokens/${chunk.join(',')}`);
      if (Array.isArray(body?.pairs)) out.push(...body.pairs);
    } catch (err) {
      log.warn('lot ignoré:', err.message);
    }
  }
  return out.filter((p) => p.chainId === 'solana');
}

/**
 * Un token peut avoir plusieurs paires (Raydium, Orca, Meteora…).
 * On ne garde que la plus liquide : c'est celle qui reflète le vrai prix
 * et sur laquelle le swap passera.
 */
export function bestPairPerToken(pairs) {
  const byToken = new Map();
  for (const pair of pairs) {
    const address = pair.baseToken?.address;
    if (!address) continue;
    const liquidity = Number(pair.liquidity?.usd ?? 0);
    const current = byToken.get(address);
    if (!current || liquidity > Number(current.liquidity?.usd ?? 0)) byToken.set(address, pair);
  }
  return [...byToken.values()];
}

/** Normalise la réponse DexScreener en un objet stable pour le scoring. */
export function normalise(pair) {
  const createdAt = Number(pair.pairCreatedAt ?? 0);
  return {
    address: pair.baseToken?.address,
    symbol: pair.baseToken?.symbol ?? '???',
    name: pair.baseToken?.name ?? '',
    pairAddress: pair.pairAddress,
    dex: pair.dexId,
    url: pair.url,
    priceUsd: Number(pair.priceUsd ?? 0),
    liquidityUsd: Number(pair.liquidity?.usd ?? 0),
    fdv: Number(pair.fdv ?? 0),
    marketCap: Number(pair.marketCap ?? pair.fdv ?? 0),
    volume: {
      m5: Number(pair.volume?.m5 ?? 0),
      h1: Number(pair.volume?.h1 ?? 0),
      h24: Number(pair.volume?.h24 ?? 0),
    },
    change: {
      m5: Number(pair.priceChange?.m5 ?? 0),
      h1: Number(pair.priceChange?.h1 ?? 0),
      h24: Number(pair.priceChange?.h24 ?? 0),
    },
    txns: {
      m5: pair.txns?.m5 ?? { buys: 0, sells: 0 },
      h1: pair.txns?.h1 ?? { buys: 0, sells: 0 },
    },
    createdAt,
    ageMinutes: createdAt ? Math.max(0, (Date.now() - createdAt) / 60_000) : null,
    socials: {
      websites: pair.info?.websites?.length ?? 0,
      socials: pair.info?.socials?.length ?? 0,
      image: Boolean(pair.info?.imageUrl),
    },
  };
}

/** Rafraîchit le prix d'un token déjà détenu (une paire précise). */
export async function refreshToken(address) {
  const body = await get(`${BASE}/latest/dex/tokens/${address}`);
  const pairs = (body?.pairs ?? []).filter((p) => p.chainId === 'solana');
  if (!pairs.length) return null;
  return normalise(bestPairPerToken(pairs)[0]);
}
