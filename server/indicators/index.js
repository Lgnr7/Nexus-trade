import { avg, stdev } from '../util/num.js';

/** Moyenne mobile simple sur la fenêtre la plus récente. */
export const sma = (values, period) =>
  values.length < period ? null : avg(values.slice(-period));

/** Série complète d'EMA (utile pour MACD qui enchaîne deux lissages). */
export function emaSeries(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out = [avg(values.slice(0, period))];
  for (let i = period; i < values.length; i += 1) {
    out.push(values[i] * k + out[out.length - 1] * (1 - k));
  }
  return out;
}

export const ema = (values, period) => {
  const s = emaSeries(values, period);
  return s.length ? s[s.length - 1] : null;
};

/**
 * RSI de Wilder (lissage exponentiel des gains/pertes), pas la version
 * "moyenne simple" : c'est celle qu'affichent TradingView et Kraken.
 */
export function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i += 1) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

export function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  if (closes.length < slow + signalPeriod) return null;
  const fastSeries = emaSeries(closes, fast);
  const slowSeries = emaSeries(closes, slow);
  // Les deux séries n'ont pas la même longueur : on aligne sur la plus courte.
  const offset = fastSeries.length - slowSeries.length;
  const macdLine = slowSeries.map((v, i) => fastSeries[i + offset] - v);
  const signalSeries = emaSeries(macdLine, signalPeriod);
  if (!signalSeries.length) return null;
  const line = macdLine[macdLine.length - 1];
  const signal = signalSeries[signalSeries.length - 1];
  const prevLine = macdLine[macdLine.length - 2] ?? line;
  const prevSignal = signalSeries[signalSeries.length - 2] ?? signal;
  return {
    line,
    signal,
    histogram: line - signal,
    // Croisement sur la dernière bougie : c'est le signal, pas juste le sens.
    crossUp: prevLine <= prevSignal && line > signal,
    crossDown: prevLine >= prevSignal && line < signal,
  };
}

export function bollinger(closes, period = 20, mult = 2) {
  if (closes.length < period) return null;
  const window = closes.slice(-period);
  const mid = avg(window);
  const sd = stdev(window);
  const upper = mid + mult * sd;
  const lower = mid - mult * sd;
  const price = closes[closes.length - 1];
  const width = mid === 0 ? 0 : ((upper - lower) / mid) * 100;
  return {
    upper,
    mid,
    lower,
    width,
    // 0 = sur la bande basse, 1 = sur la bande haute.
    position: upper === lower ? 0.5 : (price - lower) / (upper - lower),
  };
}

/** True Range moyen — sert à dimensionner les stops par volatilité réelle. */
export function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i += 1) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return avg(trs.slice(-period));
}

/** Tendance = position du prix vs EMA rapide/lente + pente de l'EMA lente. */
export function trend(closes, fast = 9, slow = 21) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  if (emaFast === null || emaSlow === null) return null;
  const slowSeries = emaSeries(closes, slow);
  const prevSlow = slowSeries[slowSeries.length - 2] ?? emaSlow;
  const slope = prevSlow === 0 ? 0 : ((emaSlow - prevSlow) / prevSlow) * 100;
  const price = closes[closes.length - 1];
  let direction = 'neutre';
  if (emaFast > emaSlow && price > emaFast) direction = 'haussiere';
  else if (emaFast < emaSlow && price < emaFast) direction = 'baissiere';
  return { emaFast, emaSlow, slope, direction };
}

/** Volume relatif : volume de la dernière bougie vs moyenne de la fenêtre. */
export function volumeProfile(candles, period = 20) {
  if (candles.length < period) return null;
  const vols = candles.slice(-period).map((c) => c.volume);
  const mean = avg(vols);
  const last = vols[vols.length - 1];
  return { last, mean, ratio: mean === 0 ? 1 : last / mean };
}

/** Calcule d'un coup tous les indicateurs utilisés par le bot Kraken. */
export function computeAll(candles) {
  const closes = candles.map((c) => c.close);
  return {
    price: closes[closes.length - 1] ?? null,
    rsi: rsi(closes, 14),
    macd: macd(closes),
    bollinger: bollinger(closes),
    trend: trend(closes),
    volume: volumeProfile(candles),
    atr: atr(candles),
  };
}
