import { Store } from '../store.js';
import { bus } from '../bus.js';
import { createLogger } from '../logger.js';
import { dayKey } from '../util/time.js';
import { round } from '../util/num.js';

const log = createLogger('risk');

export const DEFAULT_LIMITS = {
  maxDailyLoss: 300,        // $ de perte cumulée sur la journée UTC
  maxPerKrakenTrade: 250,   // $ engagés par position Kraken
  maxPerMemecoin: 50,       // $ engagés par token Solana
  maxOpenPositions: 5,      // toutes plateformes confondues
  maxKrakenTradesPerDay: 20,
};

/**
 * Garde-fou global. Chaque ouverture de position passe par `check()` ; dès
 * qu'une limite est franchie, le manager se met en `halted` et refuse toute
 * nouvelle entrée jusqu'à la remise à zéro (manuelle ou changement de jour).
 * Les sorties ne sont jamais bloquées : on doit toujours pouvoir couper.
 */
export class RiskManager {
  constructor() {
    this.store = new Store('risk', {
      limits: { ...DEFAULT_LIMITS },
      day: dayKey(),
      realizedPnl: 0,
      krakenTradesToday: 0,
      halted: false,
      haltReason: null,
      history: [], // trades clôturés, alimente le mode apprentissage
    });
  }

  init() {
    this.store.load();
    this.#rollDay();
    return this;
  }

  get state() {
    return this.store.data;
  }

  get limits() {
    return this.store.data.limits;
  }

  /** Remet les compteurs journaliers à zéro au changement de jour UTC. */
  #rollDay() {
    const today = dayKey();
    if (this.store.data.day !== today) {
      log.info(`nouveau jour ${today} — compteurs remis à zéro`);
      this.store.data.day = today;
      this.store.data.realizedPnl = 0;
      this.store.data.krakenTradesToday = 0;
      if (this.store.data.halted && this.store.data.haltReason === 'perte-journaliere') {
        this.store.data.halted = false;
        this.store.data.haltReason = null;
      }
      this.store.save();
    }
  }

  setLimits(patch) {
    const next = { ...this.limits };
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULT_LIMITS)) continue;
      const num = Number(value);
      if (Number.isFinite(num) && num >= 0) next[key] = num;
    }
    this.store.data.limits = next;
    this.store.save();
    this.#broadcast();
    return next;
  }

  /**
   * Autorise (ou non) une nouvelle position.
   * @returns {{ok: boolean, reason?: string, size: number}} `size` est la mise
   *   effectivement autorisée, éventuellement réduite sous la limite.
   */
  check({ venue, requestedSize, openPositions }) {
    this.#rollDay();
    const s = this.store.data;

    if (s.halted) return { ok: false, reason: `trading coupé : ${s.haltReason}`, size: 0 };

    if (openPositions >= s.limits.maxOpenPositions) {
      return { ok: false, reason: `max ${s.limits.maxOpenPositions} positions ouvertes`, size: 0 };
    }

    if (venue === 'kraken' && s.krakenTradesToday >= s.limits.maxKrakenTradesPerDay) {
      return { ok: false, reason: `max ${s.limits.maxKrakenTradesPerDay} trades Kraken/jour`, size: 0 };
    }

    const cap = venue === 'kraken' ? s.limits.maxPerKrakenTrade : s.limits.maxPerMemecoin;
    const size = Math.min(requestedSize, cap);
    if (size <= 0) return { ok: false, reason: 'mise autorisée nulle', size: 0 };

    // Marge restante avant la perte max : inutile d'ouvrir une position plus
    // grosse que ce qu'on peut encore se permettre de perdre.
    const remaining = s.limits.maxDailyLoss + s.realizedPnl;
    if (remaining <= 0) {
      this.halt('perte-journaliere');
      return { ok: false, reason: 'perte journalière maximale atteinte', size: 0 };
    }

    return { ok: true, size: round(size, 2) };
  }

  /** Enregistre l'ouverture d'une position (compteur de trades du jour). */
  registerEntry({ venue }) {
    this.#rollDay();
    if (venue === 'kraken') this.store.data.krakenTradesToday += 1;
    this.store.save();
    this.#broadcast();
  }

  /** Enregistre une clôture : P&L du jour, historique et coupure éventuelle. */
  registerExit(trade) {
    this.#rollDay();
    const s = this.store.data;
    s.realizedPnl = round(s.realizedPnl + trade.pnl, 2);
    s.history.push({
      ts: Date.now(),
      venue: trade.venue,
      symbol: trade.symbol,
      score: trade.score ?? null,
      pnl: round(trade.pnl, 2),
      pnlPct: round(trade.pnlPct, 2),
      reason: trade.reason,
      holdMs: trade.holdMs ?? null,
    });
    // L'historique sert au mode apprentissage : 500 trades suffisent
    // largement et bornent la taille du fichier de persistance.
    if (s.history.length > 500) s.history = s.history.slice(-500);

    if (s.realizedPnl <= -s.limits.maxDailyLoss) {
      this.halt('perte-journaliere');
    }
    this.store.save();
    this.#broadcast();
  }

  halt(reason) {
    if (this.store.data.halted) return;
    this.store.data.halted = true;
    this.store.data.haltReason = reason;
    this.store.save();
    log.warn(`TRADING COUPÉ — ${reason}`);
    bus.emitEvent('risk:halt', { reason, realizedPnl: this.store.data.realizedPnl });
    this.#broadcast();
  }

  resume() {
    this.store.data.halted = false;
    this.store.data.haltReason = null;
    this.store.save();
    log.info('trading réautorisé manuellement');
    this.#broadcast();
  }

  snapshot() {
    this.#rollDay();
    const s = this.store.data;
    return {
      limits: s.limits,
      day: s.day,
      realizedPnl: s.realizedPnl,
      krakenTradesToday: s.krakenTradesToday,
      halted: s.halted,
      haltReason: s.haltReason,
      remainingLoss: round(s.limits.maxDailyLoss + s.realizedPnl, 2),
      tradesCount: s.history.length,
    };
  }

  #broadcast() {
    bus.emitState('risk', this.snapshot());
  }
}

export const riskManager = new RiskManager();
