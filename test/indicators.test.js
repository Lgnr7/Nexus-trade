import test from 'node:test';
import assert from 'node:assert/strict';
import { rsi, ema, macd, bollinger, atr, trend, volumeProfile } from '../server/indicators/index.js';

/** Série de référence de Wilder : 14 périodes + variations connues. */
const WILDER = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
  45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00,
  46.03, 46.41, 46.22, 45.64,
];

test('RSI suit la méthode de Wilder', () => {
  const value = rsi(WILDER, 14);
  // Valeur publiée pour cette série de référence : ~56,9 sur la dernière bougie.
  assert.ok(Math.abs(value - 56.9) < 1.5, `RSI attendu ~56,9, obtenu ${value}`);
});

test('RSI vaut 100 quand il n\'y a que des hausses et 50 sur une série plate', () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  assert.equal(rsi(up, 14), 100);
  const flat = Array.from({ length: 30 }, () => 100);
  assert.equal(rsi(flat, 14), 50);
});

test('RSI renvoie null sans assez d\'historique', () => {
  assert.equal(rsi([1, 2, 3], 14), null);
});

test('EMA pondère davantage les valeurs récentes que la moyenne simple', () => {
  const series = [...Array(20).fill(10), ...Array(10).fill(20)];
  const value = ema(series, 10);
  assert.ok(value > 15 && value <= 20, `EMA attendue entre 15 et 20, obtenue ${value}`);
});

test('MACD détecte un croisement haussier', () => {
  // Baisse longue puis remontée franche : le croisement doit tomber à la fin.
  const closes = [
    ...Array.from({ length: 40 }, (_, i) => 100 - i * 0.5),
    ...Array.from({ length: 12 }, (_, i) => 80 + i * 2),
  ];
  const result = macd(closes);
  assert.ok(result, 'MACD calculable');
  assert.ok(result.histogram > 0, 'histogramme positif après la remontée');
});

test('Bollinger place le prix sur la bande haute après une poussée', () => {
  const closes = [...Array(19).fill(100), 120];
  const bb = bollinger(closes, 20, 2);
  assert.ok(bb.position > 0.9, `position attendue proche de 1, obtenue ${bb.position}`);
  assert.ok(bb.upper > bb.mid && bb.mid > bb.lower);
});

test('ATR mesure l\'amplitude moyenne réelle', () => {
  const candles = Array.from({ length: 20 }, (_, i) => ({
    open: 100, high: 102, low: 98, close: 100, volume: 1, time: i,
  }));
  // Amplitude constante de 4 : l'ATR doit valoir exactement 4.
  assert.equal(Math.round(atr(candles, 14)), 4);
});

test('La tendance est haussière quand l\'EMA rapide dépasse la lente', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
  const t = trend(closes);
  assert.equal(t.direction, 'haussiere');
  assert.ok(t.slope > 0);
});

test('Le volume relatif compare la dernière bougie à la moyenne', () => {
  const candles = Array.from({ length: 20 }, (_, i) => ({
    open: 1, high: 1, low: 1, close: 1, time: i, volume: i === 19 ? 30 : 10,
  }));
  const v = volumeProfile(candles, 20);
  assert.ok(v.ratio > 2, `ratio attendu > 2, obtenu ${v.ratio}`);
});
