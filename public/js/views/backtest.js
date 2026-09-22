import { api } from '../api.js';
import {
  $, el, td, fillTable, money, signedMoney, pctText, num,
  pnlClass, dateTime, numberField, selectField,
} from '../util.js';
import { equityCurve } from '../charts.js';

const PAIRS = [
  ['BTC', 'XBTUSD'], ['ETH', 'ETHUSD'], ['SOL', 'SOLUSD'], ['XRP', 'XRPUSD'],
  ['ADA', 'ADAUSD'], ['DOT', 'DOTUSD'], ['LINK', 'LINKUSD'], ['AVAX', 'AVAXUSD'],
  ['LTC', 'LTCUSD'], ['BCH', 'BCHUSD'], ['ATOM', 'ATOMUSD'], ['NEAR', 'NEARUSD'],
  ['UNI', 'UNIUSD'], ['ETC', 'ETCUSD'], ['XLM', 'XLMUSD'], ['DOGE', 'XDGUSD'],
];

export function createBacktestView(ctx) {
  const params = {
    interval: 15,
    minConfirmation: 65,
    takeProfitPct: 3,
    stopLossPct: 2,
    trailingStopPct: 1.5,
    stake: 100,
    startEquity: 1000,
    pairs: PAIRS.map(([, altname]) => altname),
  };
  let lastReport = null;

  renderForm();
  // État vide explicite : une carte vide laisse croire à un bug.
  equityCurve($('#btChart'), []);
  fillTable($('#btPairs'), [], { colspan: 7, empty: 'Lance un backtest pour remplir ce tableau.' });

  function renderForm() {
    const host = $('#btForm');
    const chips = el('div', { class: 'reasons', style: 'margin-bottom:12px' },
      PAIRS.map(([symbol, altname]) => {
        const active = params.pairs.includes(altname);
        return el('button', {
          class: active ? 'btn btn--sm btn--primary' : 'btn btn--sm',
          text: symbol,
          onClick: () => {
            params.pairs = active
              ? params.pairs.filter((p) => p !== altname)
              : [...params.pairs, altname];
            renderForm();
          },
        });
      }),
    );

    host.replaceChildren(
      selectField({
        label: 'Bougies',
        value: params.interval,
        options: [
          { value: 5, label: '5 minutes' },
          { value: 15, label: '15 minutes' },
          { value: 30, label: '30 minutes' },
          { value: 60, label: '1 heure' },
          { value: 240, label: '4 heures' },
        ],
        onChange: (v) => { params.interval = Number(v); },
      }),
      numberField({ label: 'Confirmation minimum', value: params.minConfirmation, min: 0, max: 100, onChange: (v) => { params.minConfirmation = v; } }),
      numberField({ label: 'Take profit', hint: '%', value: params.takeProfitPct, min: 0.1, step: 0.1, onChange: (v) => { params.takeProfitPct = v; } }),
      numberField({ label: 'Stop loss', hint: '%', value: params.stopLossPct, min: 0.1, step: 0.1, onChange: (v) => { params.stopLossPct = v; } }),
      numberField({ label: 'Trailing stop', hint: '%', value: params.trailingStopPct, min: 0.1, step: 0.1, onChange: (v) => { params.trailingStopPct = v; } }),
      numberField({ label: 'Mise par trade', hint: '$', value: params.stake, min: 1, step: 5, onChange: (v) => { params.stake = v; } }),
      numberField({ label: 'Capital de départ par paire', hint: '$', value: params.startEquity, min: 10, step: 50, onChange: (v) => { params.startEquity = v; } }),
      el('p', { class: 'field__label', text: 'Paires testées' }),
      chips,
      el('button', {
        class: 'btn btn--primary btn--block',
        text: 'Lancer le backtest',
        onClick: (e) => run(e.target),
      }),
      el('p', { class: 'card__sub', style: 'margin-top:10px', text: 'Kraken limite son historique public à environ 720 bougies par paire : en 15 minutes cela couvre une semaine, en 4 heures environ quatre mois. Les frais taker (0,26 %) sont déduits à l\'achat et à la vente, et une bougie touchant à la fois le stop et le TP est comptée comme une perte.' }),
    );
  }

  async function run(button) {
    if (!params.pairs.length) return ctx.toast('Sélectionne au moins une paire', 'warning');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Calcul en cours…';
    $('#btMeta').textContent = 'exécution…';
    try {
      const report = await api.backtest({
        pairs: params.pairs,
        interval: params.interval,
        startEquity: params.startEquity,
        settings: {
          minConfirmation: params.minConfirmation,
          takeProfitPct: params.takeProfitPct,
          stopLossPct: params.stopLossPct,
          trailingStopPct: params.trailingStopPct,
          stake: params.stake,
        },
      });
      lastReport = report;
      render(report);
      ctx.toast(`Backtest terminé — ${report.global.trades} trades simulés`, 'good');
    } catch (err) {
      ctx.toast(err.message, 'critical');
      $('#btMeta').textContent = 'échec';
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function render(report) {
    const g = report.global;
    $('#btMeta').textContent = `${dateTime(report.ranAt)} · bougies ${report.interval} min`;

    $('#btGlobal').replaceChildren(
      el('div', { class: 'grid grid--stats' }, [
        statTile('Trades', String(g.trades)),
        statTile('Win rate', g.winRate === null ? '—' : pctText(g.winRate)),
        statTile('P&L total', signedMoney(g.totalPnl), pnlClass(g.totalPnl)),
        statTile('Rendement', g.returnPct === null ? '—' : `${g.returnPct > 0 ? '+' : ''}${num(g.returnPct, 2)} %`, pnlClass(g.returnPct)),
        statTile('Profit factor', g.profitFactor === null ? '—' : String(g.profitFactor)),
        statTile('Drawdown max', `${num(g.maxDrawdown, 2)} %`, g.maxDrawdown > 20 ? 'neg' : ''),
      ]),
      el('div', { class: 'banner banner--info', style: 'margin-top:14px' }, [
        el('span', { class: 'banner__icon', text: '◆' }),
        el('div', {}, [
          el('strong', { text: 'Seuil de confirmation' }),
          el('div', { class: 'muted', style: 'margin-top:2px', text: report.scoreAnalysis.recommendation.message }),
        ]),
      ]),
    );

    // La courbe affichée est celle de la première paire ayant produit des
    // trades : agréger des équités de paires indépendantes n'aurait pas de sens.
    const withCurve = report.pairs.find((p) => p.tradeCount > 0) ?? report.pairs[0];
    $('#btCurveSub').textContent = withCurve
      ? `${withCurve.altname} · ${withCurve.tradeCount ?? 0} trades`
      : '—';

    renderPairs(report);
    // Les courbes détaillées demandent un second appel ciblé sur la paire.
    if (withCurve && withCurve.tradeCount > 0) loadCurve(withCurve.altname);
    else equityCurve($('#btChart'), []);
  }

  async function loadCurve(altname) {
    try {
      const detail = await fetch('/api/backtest/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          altname,
          interval: params.interval,
          startEquity: params.startEquity,
          settings: {
            minConfirmation: params.minConfirmation,
            takeProfitPct: params.takeProfitPct,
            stopLossPct: params.stopLossPct,
            trailingStopPct: params.trailingStopPct,
            stake: params.stake,
          },
        }),
      }).then((r) => r.json());
      $('#btCurveSub').textContent = `${altname} · ${detail.trades?.length ?? 0} trades · capital ${money(params.startEquity)}`;
      equityCurve($('#btChart'), detail.equityCurve ?? []);
    } catch {
      equityCurve($('#btChart'), []);
    }
  }

  function renderPairs(report) {
    const rows = report.pairs.map((p) =>
      el('tr', {}, [
        td(el('span', { class: 'sym', text: p.altname }), { label: 'Paire' }),
        td(p.error ? '—' : String(p.tradeCount), { label: 'Trades', className: 'num' }),
        td(p.stats?.winRate === null || !p.stats ? '—' : pctText(p.stats.winRate), { label: 'Win rate', className: 'num' }),
        td(
          el('span', { class: pnlClass(p.stats?.totalPnl), text: p.stats ? signedMoney(p.stats.totalPnl) : '—' }),
          { label: 'P&L', className: 'num' },
        ),
        td(p.stats?.profitFactor == null ? '—' : String(p.stats.profitFactor), { label: 'Profit factor', className: 'num' }),
        td(p.stats ? `${num(p.stats.maxDrawdown, 2)} %` : '—', { label: 'Drawdown', className: 'num' }),
        td(
          p.error
            ? el('span', { class: 'badge badge--warning', text: p.error })
            : el('button', {
                class: 'btn btn--sm',
                text: 'Voir la courbe',
                disabled: !p.tradeCount,
                onClick: () => loadCurve(p.altname),
              }),
          { label: '' },
        ),
      ]),
    );
    fillTable($('#btPairs'), rows, { colspan: 7, empty: 'Aucun résultat.' });
  }

  const statTile = (label, value, className = '') =>
    el('div', { class: 'stat' }, [
      el('div', { class: 'stat__label', text: label }),
      el('div', { class: `stat__value ${className}`, text: value }),
    ]);

  return { get report() { return lastReport; } };
}
