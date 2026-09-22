import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// La config lit DATA_DIR au chargement du module : il faut donc la définir
// avant tout import, d'où les imports dynamiques ci-dessous.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-test-'));

const { RiskManager, DEFAULT_LIMITS } = await import('../server/risk/riskManager.js');
const { analyse, recentWinRate } = await import('../server/risk/learning.js');

const freshManager = () => {
  const manager = new RiskManager();
  manager.init();
  // Chaque test repart d'un état propre, sans dépendre du fichier sur disque.
  manager.store.data.limits = { ...DEFAULT_LIMITS };
  manager.store.data.realizedPnl = 0;
  manager.store.data.krakenTradesToday = 0;
  manager.store.data.halted = false;
  manager.store.data.haltReason = null;
  manager.store.data.history = [];
  return manager;
};

test('Une mise supérieure au plafond est réduite, pas refusée', () => {
  const manager = freshManager();
  const verdict = manager.check({ venue: 'kraken', requestedSize: 10_000, openPositions: 0 });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.size, DEFAULT_LIMITS.maxPerKrakenTrade);
});

test('Le plafond memecoin est plus bas que celui de Kraken', () => {
  const manager = freshManager();
  const verdict = manager.check({ venue: 'solana', requestedSize: 10_000, openPositions: 0 });
  assert.equal(verdict.size, DEFAULT_LIMITS.maxPerMemecoin);
});

test('Le nombre maximum de positions ouvertes bloque une nouvelle entrée', () => {
  const manager = freshManager();
  const verdict = manager.check({
    venue: 'kraken',
    requestedSize: 50,
    openPositions: DEFAULT_LIMITS.maxOpenPositions,
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /positions ouvertes/);
});

test('Le quota de trades Kraken par jour est respecté', () => {
  const manager = freshManager();
  for (let i = 0; i < DEFAULT_LIMITS.maxKrakenTradesPerDay; i += 1) {
    manager.registerEntry({ venue: 'kraken' });
  }
  const verdict = manager.check({ venue: 'kraken', requestedSize: 50, openPositions: 0 });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /trades Kraken/);
});

test('La perte journalière maximale coupe le trading', () => {
  const manager = freshManager();
  manager.registerExit({ venue: 'kraken', symbol: 'BTC', pnl: -DEFAULT_LIMITS.maxDailyLoss, pnlPct: -10, reason: 'stop-loss' });
  assert.equal(manager.state.halted, true);
  assert.equal(manager.check({ venue: 'kraken', requestedSize: 10, openPositions: 0 }).ok, false);
});

test('La reprise manuelle réautorise les entrées', () => {
  const manager = freshManager();
  manager.halt('test');
  manager.resume();
  assert.equal(manager.check({ venue: 'kraken', requestedSize: 10, openPositions: 0 }).ok, true);
});

test('Les compteurs journaliers repartent à zéro au changement de jour', () => {
  const manager = freshManager();
  manager.registerExit({ venue: 'kraken', symbol: 'BTC', pnl: -50, pnlPct: -2, reason: 'stop-loss' });
  manager.store.data.day = '2000-01-01';
  const snapshot = manager.snapshot();
  assert.equal(snapshot.realizedPnl, 0);
  assert.equal(snapshot.krakenTradesToday, 0);
});

test('Une limite négative ou non numérique est ignorée', () => {
  const manager = freshManager();
  const limits = manager.setLimits({ maxDailyLoss: -5, maxPerMemecoin: 'abc', maxOpenPositions: 3 });
  assert.equal(limits.maxDailyLoss, DEFAULT_LIMITS.maxDailyLoss);
  assert.equal(limits.maxPerMemecoin, DEFAULT_LIMITS.maxPerMemecoin);
  assert.equal(limits.maxOpenPositions, 3);
});

test("L'analyse par tranche recommande le premier palier rentable", () => {
  const history = [];
  // Les trades sous 70 perdent, ceux au-dessus gagnent.
  for (let i = 0; i < 12; i += 1) history.push({ score: 55, pnl: -4 });
  for (let i = 0; i < 12; i += 1) history.push({ score: 75, pnl: 6 });
  for (let i = 0; i < 12; i += 1) history.push({ score: 85, pnl: 9 });
  const result = analyse(history, { minSamples: 5 });
  assert.equal(result.recommendation.minScore, 70);
});

test("L'analyse refuse de recommander sans échantillon suffisant", () => {
  const result = analyse([{ score: 80, pnl: 5 }], { minSamples: 5 });
  assert.equal(result.recommendation.minScore, null);
  assert.equal(result.recommendation.confidence, 'insuffisant');
});

test('Le win rate récent ignore les échantillons trop petits', () => {
  assert.equal(recentWinRate([{ pnl: 1 }, { pnl: -1 }]), null);
  const history = Array.from({ length: 20 }, (_, i) => ({ pnl: i < 15 ? 1 : -1 }));
  assert.equal(recentWinRate(history, 20), 75);
});
