import crypto from 'node:crypto';
import { config, hasKrakenKeys } from '../config.js';
import { createLogger } from '../logger.js';
import { fetchJson, withRetry } from '../util/retry.js';

const log = createLogger('kraken');
const BASE = 'https://api.kraken.com';

/** Les 16 paires suivies, en altname Kraken (résolues au démarrage). */
export const WATCHED_PAIRS = [
  { symbol: 'BTC', altname: 'XBTUSD' },
  { symbol: 'ETH', altname: 'ETHUSD' },
  { symbol: 'SOL', altname: 'SOLUSD' },
  { symbol: 'XRP', altname: 'XRPUSD' },
  { symbol: 'ADA', altname: 'ADAUSD' },
  { symbol: 'DOT', altname: 'DOTUSD' },
  { symbol: 'LINK', altname: 'LINKUSD' },
  { symbol: 'AVAX', altname: 'AVAXUSD' },
  { symbol: 'LTC', altname: 'LTCUSD' },
  { symbol: 'BCH', altname: 'BCHUSD' },
  { symbol: 'ATOM', altname: 'ATOMUSD' },
  { symbol: 'NEAR', altname: 'NEARUSD' },
  { symbol: 'UNI', altname: 'UNIUSD' },
  { symbol: 'ETC', altname: 'ETCUSD' },
  { symbol: 'XLM', altname: 'XLMUSD' },
  { symbol: 'DOGE', altname: 'XDGUSD' },
];

export class KrakenClient {
  #nonceFloor = 0;
  /** altname → { key, base, quote, decimals, lotDecimals, ordermin } */
  #pairInfo = new Map();

  get configured() {
    return hasKrakenKeys();
  }

  /**
   * Kraken refuse deux requêtes privées avec le même nonce. `Date.now()` peut
   * se répéter à l'intérieur d'une même milliseconde, d'où le plancher
   * strictement croissant.
   */
  #nonce() {
    const candidate = Date.now() * 1000;
    this.#nonceFloor = Math.max(candidate, this.#nonceFloor + 1);
    return String(this.#nonceFloor);
  }

  async #public(endpoint, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = `${BASE}/0/public/${endpoint}${qs ? `?${qs}` : ''}`;
    const body = await withRetry(() => fetchJson(url, { timeout: 12_000 }), {
      attempts: 3,
      onRetry: (err, n) => log.warn(`public ${endpoint} échec (essai ${n}):`, err.message),
    });
    if (body?.error?.length) throw new Error(`Kraken: ${body.error.join(', ')}`);
    return body.result;
  }

  async #private(endpoint, params = {}) {
    if (!this.configured) {
      const err = new Error('Clés API Kraken absentes (KRAKEN_KEY / KRAKEN_SECRET)');
      err.fatal = true;
      throw err;
    }
    const path = `/0/private/${endpoint}`;
    const nonce = this.#nonce();
    const postData = new URLSearchParams({ nonce, ...params }).toString();

    // Signature Kraken : HMAC-SHA512(path + SHA256(nonce + postdata), secret).
    const sha = crypto.createHash('sha256').update(nonce + postData).digest();
    const signature = crypto
      .createHmac('sha512', Buffer.from(config.kraken.secret, 'base64'))
      .update(Buffer.concat([Buffer.from(path, 'utf8'), sha]))
      .digest('base64');

    const body = await fetchJson(`${BASE}${path}`, {
      method: 'POST',
      timeout: 20_000,
      headers: {
        'API-Key': config.kraken.key,
        'API-Sign': signature,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'nexus-trade/5.0',
      },
      body: postData,
    });

    if (body?.error?.length) {
      const err = new Error(`Kraken: ${body.error.join(', ')}`);
      // Une clé invalide ou des fonds insuffisants ne se règlent pas en
      // réessayant : on remonte l'erreur telle quelle.
      err.fatal = body.error.some((e) =>
        /Invalid key|Permission denied|Insufficient funds|Invalid nonce/i.test(e),
      );
      throw err;
    }
    return body.result;
  }

  /** Résout les altnames en noms canoniques + précisions d'ordre. */
  async loadPairs() {
    const altnames = WATCHED_PAIRS.map((p) => p.altname).join(',');
    const result = await this.#public('AssetPairs', { pair: altnames });
    for (const [key, info] of Object.entries(result || {})) {
      this.#pairInfo.set(info.altname, {
        key,
        altname: info.altname,
        wsname: info.wsname,
        decimals: info.pair_decimals ?? 4,
        lotDecimals: info.lot_decimals ?? 8,
        ordermin: Number(info.ordermin ?? 0),
        costmin: Number(info.costmin ?? 0),
      });
    }
    const missing = WATCHED_PAIRS.filter((p) => !this.#pairInfo.has(p.altname));
    if (missing.length) {
      log.warn('paires introuvables sur Kraken:', missing.map((p) => p.altname).join(', '));
    }
    log.info(`${this.#pairInfo.size} paires résolues`);
    return this.#pairInfo;
  }

  pairInfo(altname) {
    return this.#pairInfo.get(altname) || null;
  }

  /** Tickers de toutes les paires suivies, indexés par altname. */
  async tickers(altnames) {
    const list = altnames ?? WATCHED_PAIRS.map((p) => p.altname);
    const result = await this.#public('Ticker', { pair: list.join(',') });
    const out = new Map();
    for (const [key, t] of Object.entries(result || {})) {
      const info = [...this.#pairInfo.values()].find((p) => p.key === key);
      const altname = info?.altname ?? key;
      out.set(altname, {
        altname,
        price: Number(t.c?.[0] ?? 0),
        bid: Number(t.b?.[0] ?? 0),
        ask: Number(t.a?.[0] ?? 0),
        volume24h: Number(t.v?.[1] ?? 0),
        high24h: Number(t.h?.[1] ?? 0),
        low24h: Number(t.l?.[1] ?? 0),
        open24h: Number(t.o ?? 0),
      });
    }
    return out;
  }

  /** Bougies OHLC. `interval` en minutes (1, 5, 15, 30, 60, 240, 1440…). */
  async candles(altname, interval = 15, since) {
    const params = { pair: altname, interval: String(interval) };
    if (since) params.since = String(since);
    const result = await this.#public('OHLC', params);
    const series = Object.entries(result || {}).find(([k]) => k !== 'last')?.[1] ?? [];
    return series.map((row) => ({
      time: Number(row[0]) * 1000,
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      vwap: Number(row[5]),
      volume: Number(row[6]),
      trades: Number(row[7]),
    }));
  }

  async balance() {
    const result = await this.#private('Balance');
    const out = {};
    for (const [asset, amount] of Object.entries(result || {})) {
      const value = Number(amount);
      if (value > 0) out[asset] = value;
    }
    return out;
  }

  /** Vérifie que les clés sont valides et lisibles. */
  async verifyCredentials() {
    await this.#private('Balance');
    return true;
  }

  /**
   * Ordre au marché. `validate: true` demande à Kraken de valider sans
   * exécuter — utilisé pour tester la configuration sans risquer un trade.
   */
  async marketOrder({ altname, side, volume, validate = false }) {
    const info = this.pairInfo(altname);
    const params = {
      pair: altname,
      type: side,
      ordertype: 'market',
      volume: volume.toFixed(info?.lotDecimals ?? 8),
    };
    if (validate) params.validate = 'true';
    const result = await this.#private('AddOrder', params);
    return { txid: result?.txid?.[0] ?? null, description: result?.descr?.order ?? '', validate };
  }

  /** Détail d'un ordre exécuté : prix moyen et frais réels. */
  async queryOrder(txid) {
    const result = await this.#private('QueryOrders', { txid });
    const order = result?.[txid];
    if (!order) return null;
    return {
      status: order.status,
      price: Number(order.price ?? 0),
      volume: Number(order.vol_exec ?? 0),
      cost: Number(order.cost ?? 0),
      fee: Number(order.fee ?? 0),
    };
  }
}

export const kraken = new KrakenClient();
