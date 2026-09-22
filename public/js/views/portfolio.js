import { api } from '../api.js';
import { $, el, td, fillTable, money, signedMoney, price, num, pnlClass, sinceText } from '../util.js';

export function createPortfolioView(ctx) {
  $('#pfRefresh').addEventListener('click', (e) => ctx.runButton(e.target, refresh(), 'Portefeuille actualisé'));

  async function refresh() {
    const data = await api.portfolio();
    render(data);
    return data;
  }

  function render(p) {
    $('#pfTotal').textContent = money(p.totalValue);
    $('#pfUpdated').textContent = sinceText(p.updatedAt);

    setPnl('#pfOpen', p.openPnl);
    setPnl('#pfRealised', p.realisedToday);
    setPnl('#pfSession', p.sessionPnl);

    renderSide('#pfKraken', '#pfKrakenSub', p.kraken, 'Kraken');
    renderSide('#pfSolana', '#pfSolanaSub', p.solana, 'Solana');

    ctx.setTopStats({ equity: p.totalValue, pnl: p.sessionPnl });
  }

  function setPnl(selector, value) {
    const node = $(selector);
    node.textContent = signedMoney(value);
    node.className = `stat__value ${pnlClass(value)}`;
  }

  function renderSide(tbodySel, subSel, side, name) {
    const sub = $(subSel);
    if (side.error) {
      sub.textContent = `erreur : ${side.error}`;
      sub.className = 'card__sub neg';
    } else {
      sub.textContent =
        `${side.source === 'live' ? 'soldes réels' : 'démo'} · ${money(side.totalUsd)}` +
        (side.openPositions ? ` · ${side.openPositions} position(s) ${money(side.positionsValue)}` : '');
      sub.className = 'card__sub';
    }

    const rows = (side.assets ?? []).map((a) =>
      el('tr', {}, [
        td(el('span', { class: 'sym', text: a.asset }), { label: 'Actif' }),
        td(num(a.amount, 6), { label: 'Quantité', className: 'num' }),
        td(a.price === undefined ? '—' : price(a.price), { label: 'Prix', className: 'num' }),
        td(money(a.valueUsd), { label: 'Valeur', className: 'num' }),
      ]),
    );
    fillTable($(tbodySel), rows, { colspan: 4, empty: `Aucun actif ${name}.` });
  }

  return { refresh };
}
