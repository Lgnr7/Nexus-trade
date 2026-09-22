import { api } from '../api.js';
import {
  $, el, td, fillTable, meter, money, signedMoney, signedPct, price, num,
  pnlClass, sinceText, durationText, dateTime, numberField, toggleField, selectField,
} from '../util.js';

const TREND_LABEL = { haussiere: '▲ haussière', baissiere: '▼ baissière', neutre: '— neutre' };

export function createKrakenView(ctx) {
  let snapshot = null;
  let settingsSignature = '';

  $('#krakenToggle').addEventListener('click', () => {
    ctx.run(snapshot?.running ? api.kraken.stop() : api.kraken.start());
  });
  $('#krakenScan').addEventListener('click', (e) => ctx.runButton(e.target, api.kraken.scan(), 'Scan terminé'));
  $('#krakenCloseAll').addEventListener('click', (e) => {
    if (!snapshot?.positions.length) return ctx.toast('Aucune position ouverte', 'info');
    ctx.confirm({
      title: 'Fermer toutes les positions ?',
      text: `${snapshot.positions.length} position(s) seront vendues au prix du marché.`,
      onConfirm: () => ctx.runButton(e.target, api.kraken.closeAll(), 'Positions fermées'),
    });
  });

  $('#panicButton').addEventListener('click', (e) => {
    ctx.confirm({
      title: "Arrêt d'urgence",
      text: 'Les deux bots seront arrêtés, toutes les positions fermées et le trading coupé jusqu\'à réautorisation manuelle.',
      onConfirm: () => ctx.runButton(e.target, api.risk.panic(), 'Tout a été coupé'),
    });
  });

  $('#krModeSwitch').addEventListener('click', (event) => {
    const mode = event.target.dataset?.mode;
    if (!mode || mode === snapshot?.mode) return;
    if (mode === 'live') {
      ctx.confirm({
        title: 'Passer en mode LIVE ?',
        text: 'Le bot passera des ordres réels sur ton compte Kraken, avec de l\'argent réel. Vérifie tes limites de risque avant de confirmer.',
        onConfirm: () => ctx.run(api.kraken.mode('live'), 'Mode LIVE activé'),
      });
    } else {
      ctx.run(api.kraken.mode('demo'), 'Retour en mode démo');
    }
  });

  function render(next) {
    snapshot = next;
    renderStats();
    renderPositions();
    renderMarket();
    renderClosed();
    renderMode();
    renderSettings();
  }

  function renderStats() {
    $('#krakenToggle').textContent = snapshot.running ? 'Arrêter' : 'Démarrer';
    $('#krakenToggle').classList.toggle('btn--primary', !snapshot.running);
    $('#krakenToggle').classList.toggle('btn--danger', snapshot.running);

    const live = snapshot.mode === 'live';
    $('#krSolde').textContent = live ? '—' : money(snapshot.demoBalance);
    $('#krSoldeHint').textContent = live
      ? 'soldes réels dans l\'onglet Portefeuille'
      : `équité démo ${money(snapshot.equity)}`;

    const pnl = $('#krOpenPnl');
    pnl.textContent = signedMoney(snapshot.openPnl);
    pnl.className = `stat__value ${pnlClass(snapshot.openPnl)}`;
    $('#krPositionsCount').textContent =
      `${snapshot.positions.length} / ${snapshot.settings.maxConcurrent} position(s)`;

    const conf = snapshot.confirmation;
    $('#krThreshold').textContent = conf.threshold;
    $('#krThresholdHint').textContent = conf.adjustment
      ? `${conf.adjustment > 0 ? '+' : '−'}${Math.abs(conf.adjustment)} (win rate ${conf.winRate} %)`
      : conf.winRate !== null
        ? `win rate récent ${conf.winRate} %`
        : 'pas encore d\'historique';

    $('#krLastScan').textContent = snapshot.lastScan ? sinceText(snapshot.lastScan) : '—';
    const conn = $('#krConn');
    conn.textContent = snapshot.connection.ok ? snapshot.connection.message : `échec : ${snapshot.connection.message}`;
    conn.className = `stat__hint ${snapshot.connection.ok ? 'muted' : 'neg'}`;

    $('#krScanSub').textContent = snapshot.market.length
      ? `${snapshot.market.length} paires analysées · seuil ${snapshot.confirmation.threshold}`
      : snapshot.running
        ? 'premier scan en cours…'
        : 'bot à l\'arrêt — aucun scan effectué';

    ctx.setBadge('kraken', snapshot.positions.length);
  }

  function renderPositions() {
    const rows = snapshot.positions.map((p) =>
      el('tr', {}, [
        td(el('span', { class: 'sym', text: p.symbol }), { label: 'Paire' }),
        td(price(p.entryPrice), { label: 'Entrée', className: 'num' }),
        td(price(p.currentPrice), { label: 'Actuel', className: 'num' }),
        td(
          el('span', { class: pnlClass(p.pnl), text: `${signedMoney(p.pnl)} (${signedPct(p.pnlPct)})` }),
          { label: 'P&L', className: 'num' },
        ),
        td(`${price(p.takeProfit)} / ${price(p.stopLoss)}`, { label: 'TP / SL', className: 'num' }),
        td(p.trailingStop ? price(p.trailingStop) : '—', { label: 'Trailing', className: 'num' }),
        td(String(p.score), { label: 'Score', className: 'num' }),
        td(
          el('button', {
            class: 'btn btn--sm btn--danger',
            text: 'Fermer',
            onClick: (e) => ctx.runButton(e.target, api.kraken.close(p.id), `${p.symbol} fermée`),
          }),
          { label: '' },
        ),
      ]),
    );
    fillTable($('#krPositions'), rows, { colspan: 8, empty: 'Aucune position ouverte.' });
  }

  function renderMarket() {
    const threshold = snapshot.confirmation.threshold;
    const rows = snapshot.market.map((m) => {
      const eligible = m.bias === 'achat' && m.confidence >= threshold;
      return el('tr', {}, [
        td(
          el('span', {}, [
            el('span', { class: 'sym', text: m.symbol }),
            eligible ? el('span', { class: 'badge badge--good', text: 'signal', style: 'margin-left:6px' }) : null,
          ]),
          { label: 'Paire' },
        ),
        td(price(m.price), { label: 'Prix', className: 'num' }),
        td(
          el('span', { class: pnlClass(m.change24h), text: signedPct(m.change24h) }),
          { label: '24 h', className: 'num' },
        ),
        td(m.rsi === null ? '—' : num(m.rsi, 1), { label: 'RSI', className: 'num' }),
        td(
          el('span', { class: pnlClass(m.macd), text: m.macd === null ? '—' : (m.macd > 0 ? '▲' : '▼') }),
          { label: 'MACD', className: 'num' },
        ),
        td(TREND_LABEL[m.trend] ?? '—', { label: 'Tendance' }),
        td(m.volumeRatio === null ? '—' : `×${num(m.volumeRatio, 2)}`, { label: 'Volume', className: 'num' }),
        td(m.bbPosition === null ? '—' : num(m.bbPosition, 2), { label: 'Bollinger', className: 'num' }),
        td(m.atrPct === null ? '—' : `${num(m.atrPct, 2)} %`, { label: 'ATR', className: 'num' }),
        td(meter(m.confidence), { label: 'Confiance', className: 'num' }),
        td(
          el('button', {
            class: 'btn btn--sm',
            text: 'Acheter',
            title: (m.reasons ?? []).join(' · '),
            onClick: (e) => ctx.runButton(e.target, api.kraken.buy(m.altname), `Ordre ${m.symbol} envoyé`),
          }),
          { label: '' },
        ),
      ]);
    });
    // Trois raisons possibles à un tableau vide, et elles appellent trois
    // actions différentes : ne pas envoyer l'utilisateur vérifier sa connexion
    // alors qu'il lui suffit de lancer un scan.
    let empty;
    if (!snapshot.connection.ok) empty = `Kraken injoignable : ${snapshot.connection.message}`;
    else if (!snapshot.lastScan) empty = 'Clique sur « Scanner » pour lancer la première analyse des 16 paires, ou sur « Démarrer » pour que le bot le fasse en continu.';
    else empty = 'Le dernier scan n\'a renvoyé aucune paire exploitable.';
    fillTable($('#krMarket'), rows, { colspan: 11, empty });
  }

  function renderClosed() {
    const rows = snapshot.closed.map((t) =>
      el('tr', {}, [
        td(el('span', { class: 'sym', text: t.symbol }), { label: 'Paire' }),
        td(price(t.entryPrice), { label: 'Entrée', className: 'num' }),
        td(price(t.exitPrice), { label: 'Sortie', className: 'num' }),
        td(
          el('span', { class: pnlClass(t.pnl), text: `${signedMoney(t.pnl)} (${signedPct(t.pnlPct)})` }),
          { label: 'P&L', className: 'num' },
        ),
        td(durationText(t.holdMs), { label: 'Durée', className: 'num' }),
        td(t.reason, { label: 'Motif' }),
        td(String(t.score ?? '—'), { label: 'Score', className: 'num' }),
      ]),
    );
    fillTable($('#krClosed'), rows, { colspan: 7, empty: 'Aucun trade clôturé pour le moment.' });
  }

  function renderMode() {
    for (const button of $('#krModeSwitch').children) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === snapshot.mode));
      button.disabled = button.dataset.mode === 'live' && !snapshot.liveAllowed;
    }

    const info = $('#krModeInfo');
    info.replaceChildren();

    if (snapshot.mode === 'live') {
      info.append(el('div', { class: 'banner banner--critical' }, [
        el('span', { class: 'banner__icon', text: '●' }),
        el('div', {}, ['Mode LIVE : chaque signal déclenche un ordre réel sur Kraken.']),
      ]));
    } else {
      info.append(el('p', { class: 'card__sub', text: 'Mode démo : 10 000 $ virtuels, aucun ordre réel n\'est envoyé. Les frais Kraken (0,26 %) sont simulés à l\'achat comme à la vente.' }));
    }

    if (!snapshot.liveAllowed) {
      info.append(el('p', { class: 'card__sub', style: 'margin-top:10px' }, [
        'Mode LIVE indisponible : il faut ',
        el('code', { text: 'KRAKEN_KEY' }), ', ',
        el('code', { text: 'KRAKEN_SECRET' }), ' et ',
        el('code', { text: 'ALLOW_LIVE_TRADING=true' }),
        ' dans les variables d\'environnement.',
      ]));
    }

    info.append(
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px' }, [
        el('button', {
          class: 'btn btn--sm',
          text: 'Reconnecter l\'API',
          onClick: (e) => ctx.runButton(e.target, api.kraken.reconnect(), 'Reconnexion effectuée'),
        }),
        el('button', {
          class: 'btn btn--sm',
          text: 'Réinitialiser la démo',
          disabled: snapshot.mode === 'live',
          onClick: (e) => ctx.confirm({
            title: 'Réinitialiser la démo ?',
            text: 'Le solde virtuel repart à 10 000 $ et l\'historique démo est effacé.',
            onConfirm: () => ctx.runButton(e.target, api.kraken.resetDemo(), 'Démo réinitialisée'),
          }),
        }),
      ]),
    );
  }

  function renderSettings() {
    // Les champs ne sont reconstruits que si les valeurs ont réellement changé :
    // sinon une frappe en cours serait écrasée à chaque mise à jour WebSocket.
    const signature = JSON.stringify(snapshot.settings);
    if (signature === settingsSignature) return;
    settingsSignature = signature;

    const s = snapshot.settings;
    const save = (patch) => ctx.run(api.kraken.settings(patch));

    $('#krSettings').replaceChildren(
      numberField({ label: 'Mise par position', hint: '$', value: s.stake, min: 1, step: 5, onChange: (v) => save({ stake: v }) }),
      numberField({ label: 'Take profit', hint: '%', value: s.takeProfitPct, min: 0.1, step: 0.1, onChange: (v) => save({ takeProfitPct: v }) }),
      numberField({ label: 'Stop loss', hint: '%', value: s.stopLossPct, min: 0.1, step: 0.1, onChange: (v) => save({ stopLossPct: v }) }),
      numberField({ label: 'Trailing stop', hint: '%', value: s.trailingStopPct, min: 0.1, step: 0.1, onChange: (v) => save({ trailingStopPct: v }) }),
      toggleField({ label: 'Activer le trailing stop', checked: s.useTrailingStop, onChange: (v) => save({ useTrailingStop: v }) }),
      numberField({ label: 'Confirmation minimum', hint: '0-100', value: s.minConfirmation, min: 0, max: 100, onChange: (v) => save({ minConfirmation: v }) }),
      toggleField({ label: 'Seuil adaptatif selon le win rate', checked: s.adaptiveConfirmation, onChange: (v) => save({ adaptiveConfirmation: v }) }),
      toggleField({ label: 'Stops adaptatifs ATR', checked: s.useAtrStops, onChange: (v) => save({ useAtrStops: v }) }),
      numberField({ label: 'Multiplicateur ATR', value: s.atrMultiplier, min: 0.5, step: 0.1, onChange: (v) => save({ atrMultiplier: v }) }),
      numberField({ label: 'Positions simultanées', value: s.maxConcurrent, min: 1, max: 10, onChange: (v) => save({ maxConcurrent: v }) }),
      numberField({ label: 'Intervalle de scan', hint: 'secondes', value: s.scanIntervalSec, min: 10, max: 600, step: 5, onChange: (v) => save({ scanIntervalSec: v }) }),
      selectField({
        label: 'Bougies analysées',
        value: s.candleInterval,
        options: [
          { value: 5, label: '5 minutes' },
          { value: 15, label: '15 minutes' },
          { value: 30, label: '30 minutes' },
          { value: 60, label: '1 heure' },
          { value: 240, label: '4 heures' },
        ],
        onChange: (v) => save({ candleInterval: Number(v) }),
      }),
    );
  }

  return { render };
}
