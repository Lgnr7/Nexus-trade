import { clamp, round } from '../util/num.js';

/**
 * Score 0-100 d'un token Solana fraîchement détecté.
 * Chaque critère rend une note 0-1 pondérée ; la somme des poids fait 100.
 * Rien n'est caché : `breakdown` est renvoyé au dashboard pour que chaque
 * décision du sniper soit lisible.
 */
const CRITERIA = [
  { key: 'liquidity', weight: 20, label: 'Liquidité' },
  { key: 'age', weight: 12, label: 'Âge du token' },
  { key: 'volume1h', weight: 16, label: 'Volume 1h' },
  { key: 'momentum', weight: 14, label: 'Momentum 5min' },
  { key: 'buyPressure', weight: 14, label: 'Ratio achats/ventes' },
  { key: 'marketCap', weight: 10, label: 'Market cap' },
  { key: 'activity', weight: 8, label: 'Activité transactions' },
  { key: 'socials', weight: 6, label: 'Présence sociale' },
];

const scorers = {
  // En dessous de 10k$ de liquidité, sortir d'une position coûte plus cher
  // que le gain espéré. Au-delà de 250k$, ce n'est plus un « nouveau token ».
  liquidity: (t) => {
    const l = t.liquidityUsd;
    if (l < 5_000) return 0;
    if (l < 15_000) return 0.3;
    if (l < 50_000) return 0.7;
    if (l < 250_000) return 1;
    return 0.75;
  },

  // La fenêtre intéressante : assez vieux pour ne pas être un rug instantané,
  // assez jeune pour que le mouvement ne soit pas déjà fait.
  age: (t) => {
    const m = t.ageMinutes;
    if (m === null) return 0.3;
    if (m < 3) return 0.25;
    if (m < 15) return 1;
    if (m < 60) return 0.85;
    if (m < 360) return 0.5;
    if (m < 1440) return 0.3;
    return 0.1;
  },

  // Volume rapporté à la liquidité : 1x la liquidité en 1 h = très actif.
  volume1h: (t) => {
    if (t.liquidityUsd <= 0) return 0;
    const ratio = t.volume.h1 / t.liquidityUsd;
    return clamp(ratio / 1.5, 0, 1);
  },

  momentum: (t) => {
    const m5 = t.change.m5;
    if (m5 <= -5) return 0;
    if (m5 < 0) return 0.25;
    if (m5 < 3) return 0.5;
    if (m5 < 15) return 1;
    // Au-delà de +30 % en 5 min, on achète le sommet d'une pump.
    if (m5 < 30) return 0.7;
    return 0.3;
  },

  buyPressure: (t) => {
    const { buys = 0, sells = 0 } = t.txns.m5;
    const total = buys + sells;
    if (total < 5) return 0.3;
    const ratio = buys / total;
    if (ratio < 0.4) return 0;
    return clamp((ratio - 0.4) / 0.35, 0, 1);
  },

  // Une market cap déjà élevée limite le multiple restant.
  marketCap: (t) => {
    const mc = t.marketCap;
    if (mc <= 0) return 0.3;
    if (mc < 30_000) return 0.5;
    if (mc < 300_000) return 1;
    if (mc < 2_000_000) return 0.7;
    if (mc < 10_000_000) return 0.4;
    return 0.15;
  },

  activity: (t) => {
    const total = (t.txns.h1.buys ?? 0) + (t.txns.h1.sells ?? 0);
    return clamp(total / 300, 0, 1);
  },

  socials: (t) => {
    const count = t.socials.socials + t.socials.websites;
    if (count === 0) return 0;
    if (count === 1) return 0.5;
    return t.socials.image ? 1 : 0.8;
  },
};

export function scoreToken(token) {
  const breakdown = CRITERIA.map(({ key, weight, label }) => {
    const raw = clamp(scorers[key](token), 0, 1);
    return { key, label, weight, raw: round(raw, 2), points: round(raw * weight, 1) };
  });
  const score = Math.round(breakdown.reduce((a, b) => a + b.points, 0));
  return { score, breakdown };
}

/**
 * Détection anti-manipulation. Les `blockers` interdisent l'achat automatique,
 * les `warnings` sont affichés mais ne bloquent pas.
 */
export function detectRisks(token, { devBlacklist = [] } = {}) {
  const blockers = [];
  const warnings = [];

  if (token.liquidityUsd < 5_000) blockers.push('liquidité < 5 000 $ (sortie impossible)');
  if (token.priceUsd <= 0) blockers.push('prix indisponible');
  if (devBlacklist.includes(token.address)) blockers.push('adresse blacklistée');

  // Volume énorme sans liquidité : signature classique du wash trading
  // destiné à faire monter le token dans les classements.
  if (token.liquidityUsd > 0 && token.volume.h1 / token.liquidityUsd > 25) {
    blockers.push('volume/liquidité aberrant (wash trading probable)');
  }

  const m5 = token.txns.m5;
  const m5Total = (m5.buys ?? 0) + (m5.sells ?? 0);
  if (m5Total >= 20 && (m5.sells ?? 0) / m5Total > 0.7) {
    blockers.push('ventes massives en cours (70 %+ des transactions)');
  }

  if (token.ageMinutes !== null && token.ageMinutes < 2) {
    blockers.push('token de moins de 2 minutes (pas assez de recul)');
  }

  if (token.socials.socials + token.socials.websites === 0) {
    warnings.push('aucun réseau social ni site');
  }
  if (token.marketCap > 0 && token.liquidityUsd / token.marketCap < 0.02) {
    warnings.push('liquidité très faible face à la market cap');
  }
  if (token.change.h1 > 300) warnings.push('déjà +300 % sur 1 h');
  if (token.volume.h1 > 0 && token.volume.m5 === 0) warnings.push('volume arrêté sur 5 min');

  return { blockers, warnings, safe: blockers.length === 0 };
}
