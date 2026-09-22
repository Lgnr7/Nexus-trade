import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { config, hasSolanaWallet } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('solana-wallet');

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

/**
 * Wallet Solana. Sans SOLANA_PRIVATE_KEY le module reste utilisable en
 * lecture seule : le sniper scanne et score, mais n'achète pas.
 */
class Wallet {
  #keypair = null;
  #connection = null;
  status = { connected: false, reason: 'SOLANA_PRIVATE_KEY absente', address: null, rpc: null };

  init() {
    this.#connection = new Connection(config.solana.rpc, 'confirmed');
    this.status.rpc = redactRpc(config.solana.rpc);
    // Le RPC public mainnet est rate-limité à quelques requêtes/seconde :
    // suffisant pour lire un solde, trop lent pour sniper sérieusement.
    this.status.fastRpc = !/api\.mainnet-beta\.solana\.com/.test(config.solana.rpc);

    if (!hasSolanaWallet()) {
      log.warn('wallet Solana non configuré — sniper en lecture seule');
      return this;
    }
    try {
      const secret = bs58.decode(config.solana.privateKey.trim());
      if (secret.length !== 64) {
        throw new Error(`clé de ${secret.length} octets, 64 attendus (format bs58 Phantom)`);
      }
      this.#keypair = Keypair.fromSecretKey(secret);
      this.status = {
        ...this.status,
        connected: true,
        reason: null,
        address: this.#keypair.publicKey.toBase58(),
      };
      log.info(`wallet connecté: ${this.status.address}`);
    } catch (err) {
      this.status = { ...this.status, connected: false, reason: `clé invalide: ${err.message}` };
      log.error('clé privée Solana invalide:', err.message);
    }
    return this;
  }

  get connection() {
    if (!this.#connection) this.init();
    return this.#connection;
  }

  get publicKey() {
    return this.#keypair?.publicKey ?? null;
  }

  get canTrade() {
    return Boolean(this.#keypair);
  }

  async solBalance() {
    if (!this.publicKey) return 0;
    const lamports = await this.connection.getBalance(this.publicKey);
    return lamports / 1e9;
  }

  /** Tokens SPL détenus, hors comptes vides. */
  async tokenAccounts() {
    if (!this.publicKey) return [];
    const res = await this.connection.getParsedTokenAccountsByOwner(this.publicKey, {
      programId: TOKEN_PROGRAM_ID,
    });
    return res.value
      .map((acc) => {
        const info = acc.account.data.parsed.info;
        return {
          mint: info.mint,
          amount: Number(info.tokenAmount.uiAmount ?? 0),
          decimals: info.tokenAmount.decimals,
        };
      })
      .filter((t) => t.amount > 0);
  }

  /** Signe et envoie une transaction Jupiter (base64 versionnée). */
  async signAndSend(base64Transaction) {
    if (!this.#keypair) throw new Error('wallet non connecté');
    const tx = VersionedTransaction.deserialize(Buffer.from(base64Transaction, 'base64'));
    tx.sign([this.#keypair]);
    const signature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    const latest = await this.connection.getLatestBlockhash();
    const confirmation = await this.connection.confirmTransaction(
      { signature, ...latest },
      'confirmed',
    );
    if (confirmation.value.err) {
      throw new Error(`transaction échouée: ${JSON.stringify(confirmation.value.err)}`);
    }
    return signature;
  }
}

/** Masque la clé API souvent présente dans l'URL d'un RPC Helius/QuickNode. */
function redactRpc(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname === '/' ? '' : '/…'}`;
  } catch {
    return 'rpc invalide';
  }
}

export const wallet = new Wallet();
