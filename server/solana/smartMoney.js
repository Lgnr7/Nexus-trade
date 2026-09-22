import { PublicKey } from '@solana/web3.js';
import { wallet } from './wallet.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { minutes } from '../util/time.js';

const log = createLogger('smart-money');

/**
 * Suivi on-chain des wallets « smart money ». Pour chaque wallet suivi, on
 * lit ses dernières transactions et on en extrait les tokens dont son solde a
 * augmenté : c'est un achat. Un token acheté par plusieurs de ces wallets est
 * un signal fort, utilisé comme bonus de score par le sniper.
 *
 * Tout passe par le RPC configuré. Sur le RPC public mainnet (rate limit
 * sévère) le scan est volontairement lent ; avec un RPC type Helius il peut
 * tourner toutes les minutes.
 */
export class SmartMoneyTracker {
  #timer = null;

  constructor() {
    /** mint → { wallets:Set, firstSeen, lastSeen } */
    this.buys = new Map();
    this.wallets = config.solana.smartWallets.filter(isValidAddress);
    this.lastScan = null;
    this.lastError = null;
    if (config.solana.smartWallets.length !== this.wallets.length) {
      log.warn('certaines adresses SMART_WALLETS sont invalides et ont été ignorées');
    }
  }

  get enabled() {
    return this.wallets.length > 0;
  }

  start() {
    if (!this.enabled) {
      log.info('aucun wallet à suivre (SMART_WALLETS vide)');
      return this;
    }
    const interval = wallet.status.fastRpc ? minutes(1) : minutes(5);
    log.info(`suivi de ${this.wallets.length} wallet(s), scan toutes les ${interval / 60000} min`);
    this.scan().catch((err) => log.error('scan initial:', err.message));
    this.#timer = setInterval(
      () => this.scan().catch((err) => log.error('scan:', err.message)),
      interval,
    );
    return this;
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  async scan() {
    if (!this.enabled) return;
    const connection = wallet.connection;
    for (const address of this.wallets) {
      try {
        await this.#scanWallet(connection, address);
      } catch (err) {
        this.lastError = err.message;
        log.warn(`wallet ${address.slice(0, 6)}… ignoré:`, err.message);
      }
    }
    this.#prune();
    this.lastScan = Date.now();
  }

  async #scanWallet(connection, address) {
    const pubkey = new PublicKey(address);
    const signatures = await connection.getSignaturesForAddress(pubkey, { limit: 10 });
    for (const { signature, err } of signatures) {
      if (err) continue; // transaction échouée : aucun achat réel
      const tx = await connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });
      if (!tx?.meta) continue;
      for (const mint of extractAcquiredMints(tx, address)) {
        const entry = this.buys.get(mint) ?? { wallets: new Set(), firstSeen: Date.now() };
        entry.wallets.add(address);
        entry.lastSeen = Date.now();
        this.buys.set(mint, entry);
      }
    }
  }

  /** Un achat de plus de 6 h ne dit plus rien d'utile sur un memecoin. */
  #prune() {
    const cutoff = Date.now() - minutes(360);
    for (const [mint, entry] of this.buys) {
      if (entry.lastSeen < cutoff) this.buys.delete(mint);
    }
  }

  /** Nombre de wallets suivis ayant acheté ce token récemment. */
  interestIn(mint) {
    const entry = this.buys.get(mint);
    if (!entry) return { count: 0, wallets: [] };
    return { count: entry.wallets.size, wallets: [...entry.wallets] };
  }

  snapshot() {
    return {
      enabled: this.enabled,
      tracked: this.wallets.length,
      lastScan: this.lastScan,
      lastError: this.lastError,
      fastRpc: wallet.status.fastRpc,
      hits: [...this.buys.entries()]
        .map(([mint, entry]) => ({
          mint,
          wallets: entry.wallets.size,
          lastSeen: entry.lastSeen,
        }))
        .sort((a, b) => b.wallets - a.wallets || b.lastSeen - a.lastSeen)
        .slice(0, 25),
    };
  }
}

/** Une adresse Solana valide est une clé publique ed25519 encodée en bs58. */
function isValidAddress(address) {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compare les soldes de tokens avant/après pour le propriétaire donné et
 * renvoie les mints dont le solde a augmenté.
 */
function extractAcquiredMints(tx, owner) {
  const pre = new Map();
  for (const bal of tx.meta.preTokenBalances ?? []) {
    if (bal.owner === owner) pre.set(bal.mint, Number(bal.uiTokenAmount.uiAmount ?? 0));
  }
  const acquired = [];
  for (const bal of tx.meta.postTokenBalances ?? []) {
    if (bal.owner !== owner) continue;
    const before = pre.get(bal.mint) ?? 0;
    const after = Number(bal.uiTokenAmount.uiAmount ?? 0);
    if (after > before) acquired.push(bal.mint);
  }
  return acquired;
}

/**
 * Inspection du créateur d'un token : on remonte à la transaction la plus
 * ancienne du mint, son payeur de frais est le déployeur. On regarde ensuite
 * si cette adresse est blacklistée et à quel point elle est active.
 * Résultat mis en cache : l'appel coûte plusieurs requêtes RPC.
 */
const creatorCache = new Map();

export async function inspectCreator(mint) {
  if (creatorCache.has(mint)) return creatorCache.get(mint);
  const result = { creator: null, blacklisted: false, deployCount: null, error: null };
  try {
    const connection = wallet.connection;
    const pubkey = new PublicKey(mint);
    // getSignaturesForAddress renvoie du plus récent au plus ancien : on
    // pagine jusqu'à la fin pour atteindre la transaction de création.
    let before;
    let oldest = null;
    for (let page = 0; page < 3; page += 1) {
      const sigs = await connection.getSignaturesForAddress(pubkey, { limit: 1000, before });
      if (!sigs.length) break;
      oldest = sigs[sigs.length - 1];
      if (sigs.length < 1000) break;
      before = oldest.signature;
    }
    if (!oldest) throw new Error('aucune transaction trouvée pour ce mint');

    const tx = await connection.getParsedTransaction(oldest.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    const creator = tx?.transaction?.message?.accountKeys?.find((k) => k.signer)?.pubkey?.toBase58();
    result.creator = creator ?? null;
    if (creator) {
      result.blacklisted = config.solana.devBlacklist.includes(creator);
      const creatorSigs = await connection.getSignaturesForAddress(new PublicKey(creator), {
        limit: 200,
      });
      // Une adresse qui enchaîne des centaines de transactions récentes est
      // typiquement un déployeur en série, pas un projet isolé.
      result.deployCount = creatorSigs.length;
    }
  } catch (err) {
    result.error = err.message;
  }
  creatorCache.set(mint, result);
  if (creatorCache.size > 500) creatorCache.delete(creatorCache.keys().next().value);
  return result;
}

export const smartMoney = new SmartMoneyTracker();
