import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreToken, detectRisks } from '../server/solana/scoring.js';

/** Token « idéal » : liquide, jeune, actif, avec de la pression acheteuse. */
const strong = {
  address: 'Token111111111111111111111111111111111111111',
  symbol: 'GOOD',
  priceUsd: 0.0001,
  liquidityUsd: 80_000,
  marketCap: 250_000,
  fdv: 250_000,
  volume: { m5: 9_000, h1: 90_000, h24: 300_000 },
  change: { m5: 8, h1: 40, h24: 120 },
  txns: { m5: { buys: 40, sells: 8 }, h1: { buys: 260, sells: 90 } },
  ageMinutes: 9,
  socials: { websites: 1, socials: 2, image: true },
};

const weak = {
  ...strong,
  symbol: 'RUG',
  liquidityUsd: 2_000,
  marketCap: 40_000_000,
  volume: { m5: 0, h1: 500, h24: 1_000 },
  change: { m5: -20, h1: -60, h24: -90 },
  txns: { m5: { buys: 2, sells: 30 }, h1: { buys: 10, sells: 90 } },
  ageMinutes: 5_000,
  socials: { websites: 0, socials: 0, image: false },
};

test('Le score reste toujours entre 0 et 100', () => {
  for (const token of [strong, weak]) {
    const { score } = scoreToken(token);
    assert.ok(score >= 0 && score <= 100, `score hors bornes: ${score}`);
  }
});

test('Un bon token score nettement plus haut qu\'un mauvais', () => {
  assert.ok(scoreToken(strong).score > 70);
  assert.ok(scoreToken(weak).score < 30);
});

test('Le détail du score couvre tous les critères et somme au total', () => {
  const { score, breakdown } = scoreToken(strong);
  assert.equal(breakdown.length, 8);
  const total = breakdown.reduce((a, b) => a + b.points, 0);
  assert.ok(Math.abs(total - score) <= 1, `somme ${total} vs score ${score}`);
  assert.equal(breakdown.reduce((a, b) => a + b.weight, 0), 100);
});

test('Une liquidité trop faible bloque l\'achat automatique', () => {
  const risks = detectRisks({ ...strong, liquidityUsd: 1_000 });
  assert.equal(risks.safe, false);
  assert.ok(risks.blockers.some((b) => /liquidité/.test(b)));
});

test('Un volume aberrant face à la liquidité est traité comme du wash trading', () => {
  const risks = detectRisks({ ...strong, liquidityUsd: 10_000, volume: { m5: 1, h1: 900_000, h24: 1 } });
  assert.ok(risks.blockers.some((b) => /wash trading/.test(b)));
});

test('Des ventes massives bloquent l\'entrée', () => {
  const risks = detectRisks({ ...strong, txns: { ...strong.txns, m5: { buys: 3, sells: 40 } } });
  assert.ok(risks.blockers.some((b) => /ventes massives/.test(b)));
});

test('Un token de moins de deux minutes est écarté', () => {
  assert.equal(detectRisks({ ...strong, ageMinutes: 1 }).safe, false);
});

test('Une adresse blacklistée est bloquée', () => {
  const risks = detectRisks(strong, { devBlacklist: [strong.address] });
  assert.ok(risks.blockers.some((b) => /blacklistée/.test(b)));
});

test('L\'absence de réseaux sociaux avertit sans bloquer', () => {
  const risks = detectRisks({ ...strong, socials: { websites: 0, socials: 0, image: false } });
  assert.equal(risks.safe, true);
  assert.ok(risks.warnings.some((w) => /réseau social/.test(w)));
});

test('Un token sain ne déclenche aucun blocage', () => {
  assert.equal(detectRisks(strong).safe, true);
});
