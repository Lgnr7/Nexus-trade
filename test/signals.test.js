import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, shouldExitOnSignal } from '../server/indicators/signals.js';

const base = {
  rsi: 50,
  macd: { line: 0, signal: 0, histogram: 0, crossUp: false, crossDown: false },
  bollinger: { upper: 110, mid: 100, lower: 90, width: 20, position: 0.5 },
  trend: { emaFast: 100, emaSlow: 100, slope: 0, direction: 'neutre' },
  volume: { last: 10, mean: 10, ratio: 1 },
  atr: 2,
  price: 100,
};

test('Une configuration neutre donne une confiance médiane', () => {
  const result = evaluate(base);
  assert.equal(result.bias, 'neutre');
  assert.ok(Math.abs(result.confidence - 50) <= 1);
  assert.equal(result.ready, true);
});

test('Tous les signaux haussiers poussent la confiance au maximum', () => {
  const result = evaluate({
    ...base,
    rsi: 25,
    macd: { ...base.macd, crossUp: true, histogram: 1 },
    bollinger: { ...base.bollinger, position: 0.02 },
    trend: { ...base.trend, direction: 'haussiere', slope: 1 },
    volume: { last: 30, mean: 10, ratio: 3 },
  });
  assert.equal(result.confidence, 100);
  assert.equal(result.bias, 'achat');
});

test('Tous les signaux baissiers ramènent la confiance à zéro', () => {
  const result = evaluate({
    ...base,
    rsi: 85,
    macd: { ...base.macd, crossDown: true, histogram: -1 },
    bollinger: { ...base.bollinger, position: 0.99 },
    trend: { ...base.trend, direction: 'baissiere', slope: -1 },
    volume: { last: 2, mean: 10, ratio: 0.2 },
  });
  // Le volume ne porte pas de direction : il plafonne son vote à -0,5, donc
  // la confiance descend très bas sans jamais atteindre exactement zéro.
  assert.ok(result.confidence <= 5, `confiance attendue <= 5, obtenue ${result.confidence}`);
  assert.equal(result.bias, 'vente');
});

test('La confiance reste bornée entre 0 et 100', () => {
  for (const rsiValue of [0, 15, 30, 50, 70, 85, 100]) {
    const { confidence } = evaluate({ ...base, rsi: rsiValue });
    assert.ok(confidence >= 0 && confidence <= 100, `confiance hors bornes: ${confidence}`);
  }
});

test('Des indicateurs manquants marquent l\'analyse comme incomplète', () => {
  const result = evaluate({ ...base, macd: null, bollinger: null });
  assert.equal(result.ready, false);
});

test('Un RSI en surachat extrême déclenche une sortie', () => {
  const indicators = { ...base, rsi: 80 };
  const reason = shouldExitOnSignal(indicators, evaluate(indicators));
  assert.match(reason, /surachat/);
});

test('Aucune sortie n\'est demandée sur une configuration saine', () => {
  assert.equal(shouldExitOnSignal(base, evaluate(base)), null);
});
