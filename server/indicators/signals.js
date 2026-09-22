import { clamp } from '../util/num.js';

/**
 * Chaque indicateur vote entre -1 (vendre) et +1 (acheter) avec un poids.
 * Le score final est un pourcentage de confiance 0-100 côté achat.
 * Tout passe par cette table : ajouter un indicateur = ajouter une ligne,
 * sans toucher au bot.
 */
const WEIGHTS = {
  rsi: 1.2,
  macd: 1.3,
  bollinger: 1.0,
  trend: 1.4,
  volume: 0.8,
};

function scoreRsi(rsi) {
  if (rsi === null) return null;
  // Survente franche = achat, surachat = sortie. Entre les deux, neutre.
  if (rsi <= 30) return { vote: 1, label: `survente (${rsi.toFixed(0)})` };
  if (rsi <= 40) return { vote: 0.5, label: `bas (${rsi.toFixed(0)})` };
  if (rsi >= 70) return { vote: -1, label: `surachat (${rsi.toFixed(0)})` };
  if (rsi >= 60) return { vote: -0.4, label: `haut (${rsi.toFixed(0)})` };
  return { vote: 0, label: `neutre (${rsi.toFixed(0)})` };
}

function scoreMacd(macd) {
  if (!macd) return null;
  if (macd.crossUp) return { vote: 1, label: 'croisement haussier' };
  if (macd.crossDown) return { vote: -1, label: 'croisement baissier' };
  // Un histogramme nul n'est pas un signal baissier : c'est l'absence de signal.
  if (macd.histogram === 0) return { vote: 0, label: 'histogramme plat' };
  return {
    vote: macd.histogram > 0 ? 0.4 : -0.4,
    label: macd.histogram > 0 ? 'histogramme positif' : 'histogramme négatif',
  };
}

function scoreBollinger(bb) {
  if (!bb) return null;
  if (bb.position <= 0.05) return { vote: 1, label: 'sur la bande basse' };
  if (bb.position <= 0.25) return { vote: 0.5, label: 'zone basse' };
  if (bb.position >= 0.95) return { vote: -1, label: 'sur la bande haute' };
  if (bb.position >= 0.75) return { vote: -0.5, label: 'zone haute' };
  return { vote: 0, label: 'milieu de bande' };
}

function scoreTrend(t) {
  if (!t) return null;
  if (t.direction === 'haussiere') return { vote: t.slope > 0 ? 1 : 0.6, label: 'tendance haussière' };
  if (t.direction === 'baissiere') return { vote: -1, label: 'tendance baissière' };
  return { vote: 0, label: 'sans tendance' };
}

function scoreVolume(v) {
  if (!v) return null;
  // Le volume ne donne pas de direction : il confirme ou affaiblit le reste.
  if (v.ratio >= 2) return { vote: 1, label: `volume x${v.ratio.toFixed(1)}` };
  if (v.ratio >= 1.3) return { vote: 0.5, label: `volume x${v.ratio.toFixed(1)}` };
  if (v.ratio < 0.6) return { vote: -0.5, label: `volume faible x${v.ratio.toFixed(1)}` };
  return { vote: 0, label: `volume x${v.ratio.toFixed(1)}` };
}

/**
 * Agrège les indicateurs en une confiance d'achat 0-100 et la liste des
 * raisons, pour que le dashboard explique chaque décision.
 */
export function evaluate(indicators) {
  const votes = {
    rsi: scoreRsi(indicators.rsi),
    macd: scoreMacd(indicators.macd),
    bollinger: scoreBollinger(indicators.bollinger),
    trend: scoreTrend(indicators.trend),
    volume: scoreVolume(indicators.volume),
  };

  let weighted = 0;
  let totalWeight = 0;
  const reasons = [];
  for (const [key, result] of Object.entries(votes)) {
    if (!result) continue;
    const w = WEIGHTS[key];
    weighted += result.vote * w;
    totalWeight += w;
    reasons.push({ key, vote: result.vote, label: result.label, weight: w });
  }

  if (totalWeight === 0) {
    return { confidence: 0, bias: 'neutre', reasons: [], ready: false };
  }

  const normalized = weighted / totalWeight; // -1 … +1
  const confidence = Math.round(((normalized + 1) / 2) * 100); // 0 … 100
  const bias = normalized > 0.15 ? 'achat' : normalized < -0.15 ? 'vente' : 'neutre';

  return {
    confidence,
    bias,
    reasons: reasons.sort((a, b) => Math.abs(b.vote * b.weight) - Math.abs(a.vote * a.weight)),
    // `ready` signale que tous les indicateurs ont assez d'historique.
    ready: reasons.length === Object.keys(WEIGHTS).length,
  };
}

/** Signal de sortie indépendant du TP/SL : l'analyse s'est retournée. */
export function shouldExitOnSignal(indicators, evaluation) {
  if (!evaluation.ready) return null;
  if (indicators.rsi !== null && indicators.rsi >= 78) return 'RSI en surachat extrême';
  if (indicators.macd?.crossDown && indicators.trend?.direction === 'baissiere') {
    return 'MACD baissier + tendance retournée';
  }
  if (evaluation.confidence <= 25) return 'confiance effondrée';
  return null;
}
