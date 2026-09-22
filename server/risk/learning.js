import { round, avg } from '../util/num.js';

const BRACKETS = Array.from({ length: 10 }, (_, i) => ({ min: i * 10, max: i * 10 + 10 }));

/**
 * Mode apprentissage : découpe l'historique des trades par tranche de score
 * d'entrée et mesure win rate / P&L moyen. Permet de répondre à la seule
 * question qui compte : « à partir de quel score mes trades sont rentables ? »
 */
export function analyse(history, { minSamples = 5 } = {}) {
  const scored = history.filter((t) => Number.isFinite(t.score));

  const brackets = BRACKETS.map(({ min, max }) => {
    // Le dernier bracket inclut 100.
    const trades = scored.filter((t) => t.score >= min && (max === 100 ? t.score <= 100 : t.score < max));
    const wins = trades.filter((t) => t.pnl > 0).length;
    return {
      label: `${min}-${max}`,
      min,
      max,
      trades: trades.length,
      wins,
      losses: trades.length - wins,
      winRate: trades.length ? round((wins / trades.length) * 100, 1) : null,
      avgPnl: trades.length ? round(avg(trades.map((t) => t.pnl)), 2) : null,
      totalPnl: round(trades.reduce((a, t) => a + t.pnl, 0), 2),
      // Assez d'échantillons pour que le chiffre veuille dire quelque chose.
      reliable: trades.length >= minSamples,
    };
  });

  const recommendation = recommend(brackets, minSamples);
  const overall = summarise(scored);

  return { brackets, recommendation, overall, samples: scored.length };
}

/**
 * Le score minimum recommandé est le plus bas bracket fiable à partir duquel
 * tous les brackets supérieurs fiables sont rentables. On évite ainsi de
 * recommander un seuil élevé juste parce qu'un bracket bas a eu un coup de
 * chance isolé.
 */
function recommend(brackets, minSamples) {
  const reliable = brackets.filter((b) => b.reliable);
  if (reliable.length === 0) {
    return {
      minScore: null,
      confidence: 'insuffisant',
      message: `Pas assez de trades (${minSamples} minimum par tranche) pour recommander un seuil.`,
    };
  }

  for (const bracket of reliable) {
    const above = reliable.filter((b) => b.min >= bracket.min);
    if (above.every((b) => b.avgPnl > 0)) {
      const totalTrades = above.reduce((a, b) => a + b.trades, 0);
      return {
        minScore: bracket.min,
        confidence: totalTrades >= minSamples * 4 ? 'solide' : 'indicative',
        message:
          `À partir d'un score de ${bracket.min}, toutes les tranches mesurées sont rentables ` +
          `(${totalTrades} trades analysés).`,
      };
    }
  }

  const best = reliable.reduce((a, b) => (b.avgPnl > a.avgPnl ? b : a));
  return {
    minScore: best.avgPnl > 0 ? best.min : null,
    confidence: 'faible',
    message:
      best.avgPnl > 0
        ? `Aucune tranche haute constamment rentable. La meilleure est ${best.label} (P&L moyen ${best.avgPnl}$).`
        : 'Aucune tranche de score n\'est rentable sur l\'historique actuel — revoir la stratégie avant d\'augmenter les mises.',
  };
}

function summarise(trades) {
  if (trades.length === 0) {
    return { trades: 0, winRate: null, totalPnl: 0, avgPnl: null, profitFactor: null };
  }
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  return {
    trades: trades.length,
    winRate: round((wins.length / trades.length) * 100, 1),
    totalPnl: round(grossWin - grossLoss, 2),
    avgPnl: round(avg(trades.map((t) => t.pnl)), 2),
    // Facteur de profit : > 1 = stratégie gagnante sur l'échantillon.
    profitFactor: grossLoss === 0 ? null : round(grossWin / grossLoss, 2),
  };
}

/**
 * Win rate récent, utilisé par le bot Kraken pour durcir automatiquement son
 * seuil de confirmation quand les derniers trades se passent mal.
 */
export function recentWinRate(history, window = 20) {
  const recent = history.slice(-window);
  if (recent.length < 5) return null;
  const wins = recent.filter((t) => t.pnl > 0).length;
  return (wins / recent.length) * 100;
}
