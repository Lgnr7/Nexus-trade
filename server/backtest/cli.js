#!/usr/bin/env node
import { backtestAll } from './engine.js';
import { WATCHED_PAIRS } from '../exchanges/kraken.js';

/**
 * Backtest en ligne de commande :
 *   npm run backtest -- --interval 15 --min-confirmation 70 --pairs BTC,ETH
 */
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const symbols = flag('pairs');
const pairs = symbols
  ? symbols
      .split(',')
      .map((s) => WATCHED_PAIRS.find((p) => p.symbol === s.trim().toUpperCase())?.altname)
      .filter(Boolean)
  : undefined;

const settings = {};
if (flag('min-confirmation')) settings.minConfirmation = Number(flag('min-confirmation'));
if (flag('tp')) settings.takeProfitPct = Number(flag('tp'));
if (flag('sl')) settings.stopLossPct = Number(flag('sl'));
if (flag('trailing')) settings.trailingStopPct = Number(flag('trailing'));
if (flag('stake')) settings.stake = Number(flag('stake'));

const report = await backtestAll({
  pairs,
  interval: Number(flag('interval', 15)),
  settings,
  startEquity: Number(flag('equity', 1000)),
});

console.log('\n═══ BACKTEST NEXUS TRADE ═══');
console.log(`Intervalle : ${report.interval} min · Seuil : ${report.settings.minConfirmation}`);
console.table(
  report.pairs.map((p) => ({
    paire: p.altname,
    trades: p.tradeCount,
    'win %': p.stats?.winRate ?? '—',
    'P&L $': p.stats?.totalPnl ?? '—',
    'DD %': p.stats?.maxDrawdown ?? '—',
    erreur: p.error ?? '',
  })),
);
console.log('\nGlobal :', report.global);
console.log('Seuil recommandé :', report.scoreAnalysis.recommendation.message);
