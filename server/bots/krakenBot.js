import { kraken, WATCHED_PAIRS } from '../exchanges/kraken.js';
import { computeAll } from '../indicators/index.js';
import { evaluate, shouldExitOnSignal } from '../indicators/signals.js';
import { riskManager } from '../risk/riskManager.js';
import { recentWinRate } from '../risk/learning.js';
import { Store } from '../store.js';
import { bus } from '../bus.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { round, pct, clamp } from '../util/num.js';
import { seconds } from '../util/time.js';

const log = createLogger('kraken-bot');

export const DEFAULT_SETTINGS = {
  stake: 100,              // MISE : $ engagés par position
  takeProfitPct: 3,        // TP en %
  stopLossPct: 2,          // SL en %
  trailingStopPct: 1.5,    // distance du trailing stop en %
  useTrailingStop: true,
  minConfirmation: 65,     // score minimum d'entrée (0-100)
  adaptiveConfirmation: true,
  useAtrStops: true,       // dimensionne SL/trailing sur l'ATR de la paire
  atrMultiplier: 1.8,
  scanIntervalSec: 30,
  candleInterval: 15,      // minutes
  maxConcurrent: 3,        // positions Kraken simultanées
};

const DEMO_START_BALANCE = 10_000;
// Frais Kraken taker par défaut : comptés des deux côtés pour que le P&L
// affiché en démo reste comparable au réel.
const FEE_RATE = 0.0026;

export class KrakenBot {
  #timer = null;
  #busy = false;

  constructor() {
    this.store = new Store('kraken-bot', {
      settings: { ...DEFAULT_SETTINGS },
      mode: 'demo',                 // 'demo' | 'live'
      running: false,
      demoBalance: DEMO_START_BALANCE,
      positions: [],
      closed: [],
      lastScan: null,
    });
    this.market = new Map();        // altname → { indicators, evaluation, ticker }
    this.connection = { ok: false, message: 'non connecté', checkedAt: null };
  }

  async init() {
    this.store.load();
    // Une position ouverte survit au redémarrage : on reprend là où on était.
    if (this.store.data.positions.length) {
      log.info(`${this.store.data.positions.length} position(s) reprise(s) après redémarrage`);
    }
    await this.#connect();
    if (this.store.data.running) {
      log.info('bot en cours d\'exécution avant redémarrage — relance automatique');
      this.start();
    }
    return this;
  }

  get settings() {
    return this.store.data.settings;
  }

  get mode() {
    return this.store.data.mode;
  }

  get isLive() {
    // Double verrou : le mode LIVE exige aussi ALLOW_LIVE_TRADING côté serveur.
    return this.store.data.mode === 'live' && config.allowLiveTrading && kraken.configured;
  }

  async #connect() {
    try {
      await kraken.loadPairs();
      if (kraken.configured) {
        await kraken.verifyCredentials();
        this.connection = { ok: true, message: 'clés API valides', checkedAt: Date.now() };
        log.info('connexion Kraken établie (clés valides)');
      } else {
        this.connection = {
          ok: true,
          message: 'données publiques seulement (pas de clés API)',
          checkedAt: Date.now(),
        };
        log.warn('pas de clés Kraken : mode démo uniquement');
      }
    } catch (err) {
      this.connection = { ok: false, message: err.message, checkedAt: Date.now() };
      log.error('connexion Kraken échouée:', err.message);
    }
    this.#broadcast();
  }

  async reconnect() {
    await this.#connect();
    return this.connection;
  }

  setSettings(patch) {
    const next = { ...this.settings };
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULT_SETTINGS)) continue;
      if (typeof DEFAULT_SETTINGS[key] === 'boolean') next[key] = Boolean(value);
      else {
        const num = Number(value);
        if (Number.isFinite(num) && num >= 0) next[key] = num;
      }
    }
    next.scanIntervalSec = clamp(next.scanIntervalSec, 10, 600);
    next.minConfirmation = clamp(next.minConfirmation, 0, 100);
    this.store.data.settings = next;
    this.store.save();
    if (this.store.data.running) this.#schedule(); // applique le nouvel intervalle
    this.#broadcast();
    return next;
  }

  setMode(mode) {
    if (mode === 'live') {
      if (!config.allowLiveTrading) {
        throw Object.assign(new Error('Mode LIVE désactivé côté serveur (ALLOW_LIVE_TRADING=false)'), {
          status: 403,
        });
      }
      if (!kraken.configured) {
        throw Object.assign(new Error('Mode LIVE impossible sans KRAKEN_KEY / KRAKEN_SECRET'), {
          status: 400,
        });
      }
      if (this.store.data.positions.length) {
        throw Object.assign(
          new Error('Ferme les positions démo en cours avant de passer en LIVE'),
          { status: 409 },
        );
      }
    }
    this.store.data.mode = mode === 'live' ? 'live' : 'demo';
    this.store.save();
    log.warn(`mode → ${this.store.data.mode.toUpperCase()}`);
    bus.emitEvent('kraken:mode', { mode: this.store.data.mode });
    this.#broadcast();
    return this.store.data.mode;
  }

  start() {
    this.store.data.running = true;
    this.store.save();
    this.#schedule();
    log.info(`bot démarré (${this.mode}, scan toutes les ${this.settings.scanIntervalSec}s)`);
    this.#broadcast();
    // Premier scan immédiat : sinon l'interface reste vide pendant 30 s.
    this.tick().catch((err) => log.error('scan initial:', err.message));
  }

  stop() {
    this.store.data.running = false;
    this.store.save();
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    log.info('bot arrêté (positions ouvertes conservées)');
    this.#broadcast();
  }

  #schedule() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = setInterval(
      () => this.tick().catch((err) => log.error('scan:', err.message)),
      seconds(this.settings.scanIntervalSec),
    );
  }

  /**
   * Seuil de confirmation adaptatif : si le win rate des 20 derniers trades
   * descend, le bot exige un score plus élevé avant d'entrer. Il se détend
   * (jusqu'au seuil configuré) quand les résultats redeviennent bons.
   */
  effectiveConfirmation() {
    const base = this.settings.minConfirmation;
    if (!this.settings.adaptiveConfirmation) return { threshold: base, adjustment: 0, winRate: null };
    const winRate = recentWinRate(riskManager.state.history);
    if (winRate === null) return { threshold: base, adjustment: 0, winRate: null };

    let adjustment = 0;
    if (winRate < 35) adjustment = 12;
    else if (winRate < 45) adjustment = 8;
    else if (winRate < 55) adjustment = 4;
    else if (winRate > 70) adjustment = -3;

    return { threshold: clamp(base + adjustment, 0, 95), adjustment, winRate: round(winRate, 1) };
  }

  /** Un cycle complet : scan du marché, gestion des positions, entrée éventuelle. */
  async tick() {
    if (this.#busy) return; // un scan lent ne doit pas se chevaucher avec le suivant
    this.#busy = true;
    try {
      await this.#scanMarket();
      await this.#managePositions();
      if (this.store.data.running) await this.#maybeEnter();
      this.store.data.lastScan = Date.now();
      this.store.save();
      this.#broadcast();
    } finally {
      this.#busy = false;
    }
  }

  async #scanMarket() {
    const tickers = await kraken.tickers();
    // Les bougies sont demandées en parallèle : 16 appels séquentiels
    // prendraient plus longtemps que l'intervalle de scan lui-même.
    const results = await Promise.allSettled(
      WATCHED_PAIRS.map(async (pair) => {
        const candles = await kraken.candles(pair.altname, this.settings.candleInterval);
        if (candles.length < 40) return null;
        const indicators = computeAll(candles);
        const evaluation = evaluate(indicators);
        return { pair, candles, indicators, evaluation, ticker: tickers.get(pair.altname) };
      }),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        log.warn('paire ignorée:', result.reason?.message ?? result.reason);
        continue;
      }
      if (!result.value) continue;
      const { pair, indicators, evaluation, ticker, candles } = result.value;
      this.market.set(pair.altname, {
        symbol: pair.symbol,
        altname: pair.altname,
        price: ticker?.price ?? indicators.price,
        change24h: ticker?.open24h ? round(pct(ticker.open24h, ticker.price), 2) : null,
        indicators,
        evaluation,
        atr: indicators.atr,
        lastCandle: candles[candles.length - 1]?.time ?? null,
      });
    }
  }

  /** Stops en pourcentage, éventuellement élargis par la volatilité (ATR). */
  #stopDistances(entryPrice, atr) {
    const s = this.settings;
    if (!s.useAtrStops || !atr || !entryPrice) {
      return { stopLossPct: s.stopLossPct, trailingPct: s.trailingStopPct, atrPct: null };
    }
    const atrPct = (atr / entryPrice) * 100;
    // Un stop plus serré que la volatilité normale de la paire se fait
    // sortir par le bruit ; on prend le max entre le réglage et l'ATR.
    return {
      stopLossPct: round(Math.max(s.stopLossPct, atrPct * s.atrMultiplier), 3),
      trailingPct: round(Math.max(s.trailingStopPct, atrPct * (s.atrMultiplier * 0.7)), 3),
      atrPct: round(atrPct, 3),
    };
  }

  async #maybeEnter() {
    const positions = this.store.data.positions;
    if (positions.length >= this.settings.maxConcurrent) return;

    const { threshold } = this.effectiveConfirmation();
    const held = new Set(positions.map((p) => p.altname));

    // Scanner multi-paires : on ne garde que la meilleure opportunité du
    // cycle, pas la première rencontrée.
    const candidates = [...this.market.values()]
      .filter((m) => !held.has(m.altname))
      .filter((m) => m.evaluation.ready && m.evaluation.bias === 'achat')
      .filter((m) => m.evaluation.confidence >= threshold)
      .sort((a, b) => b.evaluation.confidence - a.evaluation.confidence);

    const best = candidates[0];
    if (!best) return;

    const verdict = riskManager.check({
      venue: 'kraken',
      requestedSize: this.settings.stake,
      openPositions: positions.length,
    });
    if (!verdict.ok) {
      log.info(`entrée ${best.symbol} refusée — ${verdict.reason}`);
      return;
    }

    await this.openPosition(best, verdict.size);
  }

  async openPosition(market, size) {
    const price = market.price;
    if (!price) return null;
    const volume = size / price;
    const stops = this.#stopDistances(price, market.atr);

    let txid = null;
    let fillPrice = price;
    let fee = size * FEE_RATE;

    if (this.isLive) {
      try {
        const order = await kraken.marketOrder({ altname: market.altname, side: 'buy', volume });
        txid = order.txid;
        const detail = txid ? await kraken.queryOrder(txid).catch(() => null) : null;
        if (detail?.price) fillPrice = detail.price;
        if (detail?.fee) fee = detail.fee;
      } catch (err) {
        log.error(`ordre d'achat ${market.symbol} refusé:`, err.message);
        bus.emitEvent('kraken:order-failed', { symbol: market.symbol, error: err.message });
        return null;
      }
    } else {
      if (this.store.data.demoBalance < size) {
        log.warn('solde démo insuffisant');
        return null;
      }
      this.store.data.demoBalance = round(this.store.data.demoBalance - size - fee, 2);
    }

    const position = {
      id: `kr-${Date.now()}-${market.altname}`,
      venue: 'kraken',
      symbol: market.symbol,
      altname: market.altname,
      mode: this.mode,
      txid,
      openedAt: Date.now(),
      entryPrice: fillPrice,
      volume: round(size / fillPrice, 10),
      size: round(size, 2),
      entryFee: round(fee, 4),
      score: market.evaluation.confidence,
      reasons: market.evaluation.reasons.slice(0, 3).map((r) => `${r.key}: ${r.label}`),
      takeProfit: round(fillPrice * (1 + this.settings.takeProfitPct / 100), 10),
      stopLoss: round(fillPrice * (1 - stops.stopLossPct / 100), 10),
      trailingPct: this.settings.useTrailingStop ? stops.trailingPct : null,
      // Le trailing stop suit le plus haut atteint depuis l'entrée.
      peakPrice: fillPrice,
      trailingStop: this.settings.useTrailingStop
        ? round(fillPrice * (1 - stops.trailingPct / 100), 10)
        : null,
      atrPct: stops.atrPct,
      currentPrice: fillPrice,
      pnl: 0,
      pnlPct: 0,
    };

    this.store.data.positions.push(position);
    this.store.save();
    riskManager.registerEntry({ venue: 'kraken' });
    log.info(
      `ACHAT ${market.symbol} @ ${fillPrice} — ${size}$ (score ${position.score}, ${this.mode})`,
    );
    bus.emitEvent('kraken:entry', position);
    this.#broadcast();
    return position;
  }

  async #managePositions() {
    for (const position of [...this.store.data.positions]) {
      const market = this.market.get(position.altname);
      const price = market?.price ?? position.currentPrice;
      if (!price) continue;

      position.currentPrice = price;
      const gross = (price - position.entryPrice) * position.volume;
      const exitFee = price * position.volume * FEE_RATE;
      position.pnl = round(gross - position.entryFee - exitFee, 2);
      position.pnlPct = round(pct(position.entryPrice, price), 2);

      // Trailing stop réel : le stop ne redescend jamais.
      if (position.trailingPct && price > position.peakPrice) {
        position.peakPrice = price;
        position.trailingStop = round(price * (1 - position.trailingPct / 100), 10);
      }

      const reason = this.#exitReason(position, price, market);
      if (reason) await this.closePosition(position.id, reason);
    }
    this.store.save();
  }

  #exitReason(position, price, market) {
    if (price >= position.takeProfit) return 'take-profit';
    if (price <= position.stopLoss) return 'stop-loss';
    if (position.trailingStop && price <= position.trailingStop && price > position.entryPrice) {
      return 'trailing-stop';
    }
    // Trailing déclenché sous le prix d'entrée : c'est un stop-loss, pas un
    // gain sécurisé — on le nomme correctement pour les statistiques.
    if (position.trailingStop && price <= position.trailingStop) return 'stop-loss';
    if (market) {
      const signal = shouldExitOnSignal(market.indicators, market.evaluation);
      if (signal) return `signal: ${signal}`;
    }
    return null;
  }

  async closePosition(id, reason = 'manuelle') {
    const index = this.store.data.positions.findIndex((p) => p.id === id);
    if (index === -1) return null;
    const position = this.store.data.positions[index];
    const market = this.market.get(position.altname);
    let price = market?.price ?? position.currentPrice;
    let exitFee = price * position.volume * FEE_RATE;

    if (position.mode === 'live' && kraken.configured) {
      try {
        const order = await kraken.marketOrder({
          altname: position.altname,
          side: 'sell',
          volume: position.volume,
        });
        const detail = order.txid ? await kraken.queryOrder(order.txid).catch(() => null) : null;
        if (detail?.price) price = detail.price;
        if (detail?.fee) exitFee = detail.fee;
      } catch (err) {
        // On ne supprime surtout pas la position : elle existe toujours chez
        // Kraken et devra être fermée au prochain cycle ou à la main.
        log.error(`vente ${position.symbol} refusée:`, err.message);
        bus.emitEvent('kraken:order-failed', { symbol: position.symbol, error: err.message });
        return null;
      }
    }

    const gross = (price - position.entryPrice) * position.volume;
    const pnl = round(gross - position.entryFee - exitFee, 2);
    const pnlPct = round(pct(position.entryPrice, price), 2);

    if (position.mode !== 'live') {
      this.store.data.demoBalance = round(
        this.store.data.demoBalance + position.size + pnl,
        2,
      );
    }

    const closed = {
      ...position,
      exitPrice: price,
      exitFee: round(exitFee, 4),
      closedAt: Date.now(),
      holdMs: Date.now() - position.openedAt,
      pnl,
      pnlPct,
      reason,
    };

    this.store.data.positions.splice(index, 1);
    this.store.data.closed.unshift(closed);
    if (this.store.data.closed.length > 200) this.store.data.closed.length = 200;
    this.store.save();

    riskManager.registerExit({
      venue: 'kraken',
      symbol: position.symbol,
      score: position.score,
      pnl,
      pnlPct,
      reason,
      holdMs: closed.holdMs,
    });

    log.info(`VENTE ${position.symbol} @ ${price} — ${pnl >= 0 ? '+' : ''}${pnl}$ (${reason})`);
    bus.emitEvent('kraken:exit', closed);
    this.#broadcast();
    return closed;
  }

  async closeAll(reason = 'fermeture globale') {
    const results = [];
    for (const position of [...this.store.data.positions]) {
      results.push(await this.closePosition(position.id, reason));
    }
    return results.filter(Boolean);
  }

  resetDemo() {
    if (this.mode === 'live') {
      throw Object.assign(new Error('Impossible de réinitialiser en mode LIVE'), { status: 409 });
    }
    this.store.data.demoBalance = DEMO_START_BALANCE;
    this.store.data.positions = [];
    this.store.data.closed = [];
    this.store.save();
    this.#broadcast();
  }

  snapshot() {
    const d = this.store.data;
    const openPnl = round(d.positions.reduce((a, p) => a + p.pnl, 0), 2);
    return {
      running: d.running,
      mode: d.mode,
      liveAllowed: config.allowLiveTrading && kraken.configured,
      connection: this.connection,
      settings: d.settings,
      confirmation: this.effectiveConfirmation(),
      demoBalance: d.demoBalance,
      equity: round(d.demoBalance + d.positions.reduce((a, p) => a + p.size + p.pnl, 0), 2),
      openPnl,
      positions: d.positions,
      closed: d.closed.slice(0, 50),
      lastScan: d.lastScan,
      market: [...this.market.values()]
        .map((m) => ({
          symbol: m.symbol,
          altname: m.altname,
          price: m.price,
          change24h: m.change24h,
          confidence: m.evaluation.confidence,
          bias: m.evaluation.bias,
          ready: m.evaluation.ready,
          rsi: m.indicators.rsi === null ? null : round(m.indicators.rsi, 1),
          macd: m.indicators.macd ? round(m.indicators.macd.histogram, 6) : null,
          bbPosition: m.indicators.bollinger ? round(m.indicators.bollinger.position, 2) : null,
          trend: m.indicators.trend?.direction ?? null,
          volumeRatio: m.indicators.volume ? round(m.indicators.volume.ratio, 2) : null,
          atrPct: m.atr && m.price ? round((m.atr / m.price) * 100, 2) : null,
          reasons: m.evaluation.reasons.map((r) => `${r.key}: ${r.label}`),
        }))
        .sort((a, b) => b.confidence - a.confidence),
    };
  }

  #broadcast() {
    bus.emitState('kraken', this.snapshot());
  }
}

export const krakenBot = new KrakenBot();
