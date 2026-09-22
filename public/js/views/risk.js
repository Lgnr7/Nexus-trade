import { api } from '../api.js';
import {
  $, el, td, fillTable, money, signedMoney, signedPct, pctText,
  pnlClass, dateTime, numberField,
} from '../util.js';
import { bracketChart } from '../charts.js';

export function createRiskView(ctx) {
  let snapshot = null;
  let limitsSignature = '';

  $('#rkResume').addEventListener('click', (e) =>
    ctx.runButton(e.target, api.risk.resume(), 'Trading réautorisé'));

  function render(next) {
    snapshot = next;
    renderStats();
    renderLimits();
  }

  function renderStats() {
    const pnl = $('#rkPnl');
    pnl.textContent = signedMoney(snapshot.realizedPnl);
    pnl.className = `stat__value ${pnlClass(snapshot.realizedPnl)}`;
    $('#rkDay').textContent = `journée UTC ${snapshot.day}`;

    const remaining = $('#rkRemaining');
    remaining.textContent = money(Math.max(0, snapshot.remainingLoss));
    remaining.className = `stat__value ${snapshot.remainingLoss <= 0 ? 'neg' : snapshot.remainingLoss < snapshot.limits.maxDailyLoss * 0.25 ? 'warn' : ''}`;

    $('#rkTrades').textContent = `${snapshot.krakenTradesToday} / ${snapshot.limits.maxKrakenTradesPerDay}`;

    const status = $('#rkStatus');
    status.textContent = snapshot.halted ? '⛔ COUPÉ' : '✓ ACTIF';
    status.className = `stat__value ${snapshot.halted ? 'neg' : 'pos'}`;
    $('#rkStatusHint').textContent = snapshot.halted ? snapshot.haltReason : 'limites respectées';
    $('#rkResume').hidden = !snapshot.halted;
  }

  function renderLimits() {
    const signature = JSON.stringify(snapshot.limits);
    if (signature === limitsSignature) return;
    limitsSignature = signature;

    const l = snapshot.limits;
    const save = (patch) => ctx.run(api.risk.limits(patch), 'Limites mises à jour');

    $('#rkLimits').replaceChildren(
      numberField({ label: 'Perte max journalière', hint: '$', value: l.maxDailyLoss, min: 0, step: 10, onChange: (v) => save({ maxDailyLoss: v }) }),
      numberField({ label: 'Max par trade Kraken', hint: '$', value: l.maxPerKrakenTrade, min: 0, step: 10, onChange: (v) => save({ maxPerKrakenTrade: v }) }),
      numberField({ label: 'Max par memecoin', hint: '$', value: l.maxPerMemecoin, min: 0, step: 5, onChange: (v) => save({ maxPerMemecoin: v }) }),
      numberField({ label: 'Positions ouvertes max', value: l.maxOpenPositions, min: 1, max: 20, onChange: (v) => save({ maxOpenPositions: v }) }),
      numberField({ label: 'Trades Kraken par jour', value: l.maxKrakenTradesPerDay, min: 1, max: 200, onChange: (v) => save({ maxKrakenTradesPerDay: v }) }),
      el('p', { class: 'card__sub', text: 'Ces limites s\'appliquent aux deux bots. Une entrée dépassant le plafond est réduite automatiquement ; au-delà de la perte max, tout est coupé jusqu\'à réautorisation.' }),
    );
  }

  /** Données lourdes (apprentissage + historique) : chargées à l'ouverture. */
  async function refresh() {
    const [learning, history] = await Promise.all([api.learning(), api.history()]);
    renderLearning(learning);
    renderHistory(history);
  }

  function renderLearning(learning) {
    $('#rkSamples').textContent = `${learning.samples} trade(s) analysés`;

    const reco = learning.recommendation;
    const overall = learning.overall;
    const tone = reco.confidence === 'solide' ? 'info' : reco.confidence === 'faible' ? 'warning' : 'info';

    $('#rkRecommendation').replaceChildren(
      el('div', { class: `banner banner--${tone}`, style: 'margin-bottom:12px' }, [
        el('span', { class: 'banner__icon', text: reco.minScore === null ? '○' : '◆' }),
        el('div', {}, [
          reco.minScore === null
            ? el('strong', { text: 'Pas de seuil recommandé' })
            : el('strong', { text: `Score minimum recommandé : ${reco.minScore}` }),
          el('div', { class: 'muted', style: 'margin-top:2px', text: reco.message }),
        ]),
      ]),
      el('dl', { class: 'kv' }, [
        el('dt', { text: 'Trades' }), el('dd', { text: String(overall.trades) }),
        el('dt', { text: 'Win rate' }), el('dd', { text: overall.winRate === null ? '—' : pctText(overall.winRate) }),
        el('dt', { text: 'P&L total' }),
        el('dd', {}, [el('span', { class: pnlClass(overall.totalPnl), text: signedMoney(overall.totalPnl) })]),
        el('dt', { text: 'P&L moyen' }),
        el('dd', {}, [el('span', { class: pnlClass(overall.avgPnl), text: signedMoney(overall.avgPnl ?? 0) })]),
        el('dt', { text: 'Profit factor' }),
        el('dd', { text: overall.profitFactor === null ? '—' : String(overall.profitFactor) }),
      ]),
    );

    bracketChart($('#rkBracketChart'), learning.brackets);

    const rows = learning.brackets.map((b) =>
      el('tr', { style: b.trades ? '' : 'opacity:0.45' }, [
        td(b.label, { label: 'Tranche' }),
        td(String(b.trades), { label: 'Trades', className: 'num' }),
        td(String(b.wins), { label: 'Gagnants', className: 'num' }),
        td(b.winRate === null ? '—' : pctText(b.winRate), { label: 'Win rate', className: 'num' }),
        td(
          el('span', { class: pnlClass(b.avgPnl), text: b.avgPnl === null ? '—' : signedMoney(b.avgPnl) }),
          { label: 'P&L moyen', className: 'num' },
        ),
        td(
          el('span', { class: pnlClass(b.totalPnl), text: signedMoney(b.totalPnl) }),
          { label: 'P&L total', className: 'num' },
        ),
        td(
          b.trades === 0
            ? el('span', { class: 'muted', text: 'aucun trade' })
            : b.reliable
              ? el('span', { class: 'badge badge--good', text: 'fiable' })
              : el('span', { class: 'badge badge--warning', text: 'échantillon faible' }),
          { label: 'Fiabilité' },
        ),
      ]),
    );
    fillTable($('#rkBrackets'), rows, { colspan: 7, empty: 'Aucune donnée.' });
  }

  function renderHistory(history) {
    $('#rkHistorySub').textContent = `${history.length} trade(s) · les plus récents en premier`;
    const rows = history.map((t) =>
      el('tr', {}, [
        td(dateTime(t.ts), { label: 'Date' }),
        td(t.venue === 'kraken' ? 'Kraken' : 'Solana', { label: 'Plateforme' }),
        td(el('span', { class: 'sym', text: t.symbol }), { label: 'Actif' }),
        td(String(t.score ?? '—'), { label: 'Score', className: 'num' }),
        td(el('span', { class: pnlClass(t.pnl), text: signedMoney(t.pnl) }), { label: 'P&L', className: 'num' }),
        td(el('span', { class: pnlClass(t.pnlPct), text: signedPct(t.pnlPct) }), { label: '%', className: 'num' }),
        td(t.reason, { label: 'Motif' }),
      ]),
    );
    fillTable($('#rkHistory'), rows, { colspan: 7, empty: 'Aucun trade dans l\'historique.' });
  }

  return { render, refresh };
}
