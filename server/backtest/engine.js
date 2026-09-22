import { kraken, WATCHED_PAIRS } from '../exchanges/kraken.js';
import { computeAll } from '../indicators/index.js';
import { evaluate, shouldExitOnSignal } from '../indicators/signals.js';
import { DEFAULT_SETTINGS } from '../bots/krakenBot.js';
import { analyse } from '../risk/learning.js';
import { round, pct, avg } from '../util/num.js';
import { createLogger } from '../logger.js';

const log = createLogger('backtest');

// Kraken ne renvoie que ~720 bougies par appel OHLC, quelle que soit la
// profondeur demandée : c'est la limite de l'historique disponible ici.
const MIN_WARMUP = 50;
const FEE_RATE = 0.0026;

/**
 * Rejoue la stratégie du bot Kraken sur l'historique réel d'une paire,
 * bougie par bougie, avec exactement les mêmes règles d'entrée et de sortie
 * que le bot en production (même module de signaux).
 */
export async function backtestPair(altname, options = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...options.settings };
  const interval = options.interval ?? settings.candleInterval;
  const candles = await kraken.candles(altname, interval);

  if (candles.length < MIN_WARMUP + 10) {
    return { altname, error: `historique insuffisant (${candles.length} bougies)`, trades: [] };
  }

  const trades = [];
  let position = null;
  let equity = options.startEquity ?? 1_000;
  const equityCurve = [];

  for (let i = MIN_WARMUP; i < candles.length; i += 1) {
    const window = candles.slice(0, i + 1);
    const candle = candles[i];
    const indicators = computeAll(window);
    const evaluation = evaluate(indicators);

    if (position) {
      // Le plus haut de la bougie fait avancer le trailing stop avant que
      // le plus bas puisse le déclencher : c'est l'ordre pessimiste réaliste.
      if (candle.high > position.peak) {
        position.peak = candle.high;
        if (position.trailingPct) {
          position.trailingStop = position.peak * (1 - position.trailingPct / 100);
        }
      }

      let exitPrice = null;
      let reason = null;
      // Priorité au stop : si la bougie touche stop ET TP, on suppose le pire.
      if (candle.low <= position.stopLoss) {
        exitPrice = position.stopLoss;
        reason = 'stop-loss';
      } else if (position.trailingStop && candle.low <= position.trailingStop) {
        exitPrice = position.trailingStop;
        reason = position.trailingStop > position.entryPrice ? 'trailing-stop' : 'stop-loss';
      } else if (candle.high >= position.takeProfit) {
        exitPrice = position.takeProfit;
        reason = 'take-profit';
      } else {
        const signal = shouldExitOnSignal(indicators, evaluation);
        if (signal) {
          exitPrice = candle.close;
          reason = `signal: ${signal}`;
        }
      }

      if (exitPrice !== null) {
        const gross = (exitPrice - position.entryPrice) * position.volume;
        const fees = position.size * FEE_RATE + exitPrice * position.volume * FEE_RATE;
        const pnl = round(gross - fees, 2);
        equity = round(equity + pnl, 2);
        trades.push({
          symbol: altname,
          score: position.score,
          entryTime: position.time,
          exitTime: candle.time,
          entryPrice: position.entryPrice,
          exitPrice,
          size: position.size,
          pnl,
          pnlPct: round(pct(position.entryPrice, exitPrice), 2),
          reason,
          holdMs: candle.time - position.time,
        });
        position = null;
      }
    }

    if (!position && evaluation.ready && evaluation.bias === 'achat') {
      if (evaluation.confidence >= settings.minConfirmation) {
        const entryPrice = candle.close;
        const size = Math.min(settings.stake, equity);
        if (size > 0) {
          const atrPct = indicators.atr ? (indicators.atr / entryPrice) * 100 : null;
          const stopPct =
            settings.useAtrStops && atrPct
              ? Math.max(settings.stopLossPct, atrPct * settings.atrMultiplier)
              : settings.stopLossPct;
          const trailPct = settings.useTrailingStop
            ? settings.useAtrStops && atrPct
              ? Math.max(settings.trailingStopPct, atrPct * settings.atrMultiplier * 0.7)
              : settings.trailingStopPct
            : null;
          position = {
            time: candle.time,
            entryPrice,
            size,
            volume: size / entryPrice,
            score: evaluation.confidence,
            takeProfit: entryPrice * (1 + settings.takeProfitPct / 100),
            stopLoss: entryPrice * (1 - stopPct / 100),
            trailingPct: trailPct,
            trailingStop: trailPct ? entryPrice * (1 - trailPct / 100) : null,
            peak: entryPrice,
          };
        }
      }
    }

    equityCurve.push({ time: candle.time, equity });
  }

  return {
    altname,
    interval,
    candles: candles.length,
    from: candles[MIN_WARMUP]?.time ?? null,
    to: candles[candles.length - 1]?.time ?? null,
    trades,
    equityCurve,
    stats: computeStats(trades, options.startEquity ?? 1_000, equity),
  };
}

function computeStats(trades, startEquity, endEquity) {
  if (!trades.length) {
    return { trades: 0, winRate: null, totalPnl: 0, profitFactor: null, maxDrawdown: 0, returnPct: 0 };
  }
  const wins = trades.filter((t) => t.pnl > 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0));

  // Drawdown calculé sur l'équité cumulée trade par trade.
  let peak = startEquity;
  let equity = startEquity;
  let maxDrawdown = 0;
  for (const t of trades) {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak === 0 ? 0 : ((peak - equity) / peak) * 100);
  }

  return {
    trades: trades.length,
    wins: wins.length,
    losses: trades.length - wins.length,
    winRate: round((wins.length / trades.length) * 100, 1),
    totalPnl: round(endEquity - startEquity, 2),
    avgPnl: round(avg(trades.map((t) => t.pnl)), 2),
    bestTrade: round(Math.max(...trades.map((t) => t.pnl)), 2),
    worstTrade: round(Math.min(...trades.map((t) => t.pnl)), 2),
    profitFactor: grossLoss === 0 ? null : round(grossWin / grossLoss, 2),
    maxDrawdown: round(maxDrawdown, 2),
    returnPct: round(pct(startEquity, endEquity), 2),
    avgHoldMinutes: round(avg(trades.map((t) => t.holdMs)) / 60_000, 1),
  };
}

/** Backtest sur l'ensemble des paires suivies, agrégé. */
export async function backtestAll(options = {}) {
  const pairs = options.pairs ?? WATCHED_PAIRS.map((p) => p.altname);
  await kraken.loadPairs().catch((err) => log.warn('paires:', err.message));

  const results = [];
  for (const altname of pairs) {
    try {
      // Séquentiel volontaire : l'API publique Kraken limite le débit et un
      // backtest n'est pas dans le chemin critique.
      results.push(await backtestPair(altname, options));
    } catch (err) {
      log.warn(`${altname}: ${err.message}`);
      results.push({ altname, error: err.message, trades: [] });
    }
  }

  const allTrades = results.flatMap((r) => r.trades ?? []);
  const startEquity = (options.startEquity ?? 1_000) * results.length;
  const endEquity = startEquity + allTrades.reduce((a, t) => a + t.pnl, 0);

  return {
    ranAt: Date.now(),
    interval: options.interval ?? DEFAULT_SETTINGS.candleInterval,
    settings: { ...DEFAULT_SETTINGS, ...options.settings },
    pairs: results.map(({ equityCurve, trades, ...rest }) => ({
      ...rest,
      tradeCount: trades?.length ?? 0,
    })),
    global: computeStats(allTrades, startEquity, endEquity),
    // Réutilise l'analyse par tranche de score du mode apprentissage : le
    // backtest répond ainsi directement à « quel seuil de confirmation ? ».
    scoreAnalysis: analyse(allTrades.map((t) => ({ score: t.score, pnl: t.pnl })), { minSamples: 3 }),
  };
}
