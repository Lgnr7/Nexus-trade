import { api } from '../api.js';
import {
  $, el, td, fillTable, meter, money, signedMoney, signedPct, price, num, compact,
  pnlClass, sinceText, durationText, numberField, toggleField,
} from '../util.js';

export function createSniperView(ctx) {
  let snapshot = null;
  let settingsSignature = '';

  $('#sniperToggle').addEventListener('click', () => {
    ctx.run(snapshot?.running ? api.sniper.stop() : api.sniper.start());
  });
  $('#sniperScan').addEventListener('click', (e) => ctx.runButton(e.target, api.sniper.scan(), 'Scan DexScreener terminé'));
  $('#smartScan').addEventListener('click', (e) => ctx.runButton(e.target, api.sniper.smartMoneyScan(), 'Wallets analysés'));
  $('#sniperSellAll').addEventListener('click', (e) => {
    if (!snapshot?.positions.length) return ctx.toast('Aucune position ouverte', 'info');
    ctx.confirm({
      title: 'Tout vendre ?',
      text: `${snapshot.positions.length} token(s) seront vendus via Jupiter.`,
      onConfirm: () => ctx.runButton(e.target, api.sniper.sellAll(), 'Positions fermées'),
    });
  });

  $('#snModeSwitch').addEventListener('click', (event) => {
    const mode = event.target.dataset?.mode;
    if (!mode || mode === snapshot?.mode) return;
    if (mode === 'live') {
      ctx.confirm({
        title: 'Sniper en mode LIVE ?',
        text: 'Les achats partiront du wallet Phantom configuré, avec des SOL réels. Les memecoins peuvent perdre toute leur valeur en quelques minutes.',
        onConfirm: () => ctx.run(api.sniper.mode('live'), 'Sniper en LIVE'),
      });
    } else {
      ctx.run(api.sniper.mode('demo'), 'Sniper en démo');
    }
  });

  function render(next) {
    snapshot = next;
    renderStats();
    renderPositions();
    renderCandidates();
    renderClosed();
    renderWallet();
    renderSettings();
  }

  function renderStats() {
    $('#sniperToggle').textContent = snapshot.running ? 'Arrêter' : 'Démarrer';
    $('#sniperToggle').classList.toggle('btn--primary', !snapshot.running);
    $('#sniperToggle').classList.toggle('btn--danger', snapshot.running);

    $('#snSolde').textContent = snapshot.mode === 'live' ? '—' : money(snapshot.demoBalance);
    $('#snSoldeHint').textContent = snapshot.mode === 'live'
      ? 'solde réel dans l\'onglet Portefeuille'
      : 'solde démo';

    const pnl = $('#snOpenPnl');
    pnl.textContent = signedMoney(snapshot.openPnl);
    pnl.className = `stat__value ${pnlClass(snapshot.openPnl)}`;
    $('#snPositionsCount').textContent = `${snapshot.positions.length} / ${snapshot.settings.maxPositions} position(s)`;

    const eligible = snapshot.candidates.filter(
      (c) => c.score >= snapshot.settings.minScore && c.risks.safe,
    ).length;
    $('#snCandidates').textContent = snapshot.candidates.length || '—';
    $('#snEligible').textContent = `${eligible} au-dessus du seuil ${snapshot.settings.minScore}`;

    $('#snLastPoll').textContent = snapshot.lastPoll ? sinceText(snapshot.lastPoll) : '—';
    const walletHint = $('#snWallet');
    walletHint.textContent = snapshot.wallet.connected
      ? `wallet ${snapshot.wallet.address.slice(0, 4)}…${snapshot.wallet.address.slice(-4)}`
      : 'wallet non connecté';
    walletHint.className = `stat__hint ${snapshot.wallet.connected ? 'muted' : 'warn'}`;

    $('#snScanSub').textContent = snapshot.lastError
      ? `dernière erreur : ${snapshot.lastError}`
      : `${snapshot.candidates.length} tokens classés par score`;

    ctx.setBadge('sniper', snapshot.positions.length);
  }

  function renderPositions() {
    const rows = snapshot.positions.map((p) =>
      el('tr', {}, [
        td(
          el('span', {}, [
            el('span', { class: 'sym', text: p.symbol }),
            p.mode === 'live' ? el('span', { class: 'badge badge--critical', text: 'LIVE', style: 'margin-left:6px' }) : null,
          ]),
          { label: 'Token' },
        ),
        td(price(p.entryPrice), { label: 'Entrée', className: 'num' }),
        td(price(p.currentPrice), { label: 'Actuel', className: 'num' }),
        td(
          el('span', { class: pnlClass(p.pnl), text: `${signedMoney(p.pnl)} (${signedPct(p.pnlPct)})` }),
          { label: 'P&L', className: 'num' },
        ),
        td(String(p.score ?? '—'), { label: 'Score', className: 'num' }),
        td(durationText(Date.now() - p.openedAt), { label: 'Âge', className: 'num' }),
        td(
          el('button', {
            class: 'btn btn--sm btn--danger',
            text: 'Vendre',
            onClick: (e) => ctx.runButton(e.target, api.sniper.sell(p.id), `${p.symbol} vendu`),
          }),
          { label: '' },
        ),
      ]),
    );
    fillTable($('#snPositions'), rows, { colspan: 7, empty: 'Aucune position Solana.' });
  }

  function renderCandidates() {
    const host = $('#snCandidateList');
    host.replaceChildren();
    if (!snapshot.candidates.length) {
      host.append(el('p', { class: 'empty', text: 'Aucun token détecté pour le moment. Lance un scan.' }));
      return;
    }

    for (const c of snapshot.candidates) {
      const eligible = c.score >= snapshot.settings.minScore && c.risks.safe;

      const header = el('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:11px 14px' }, [
        el('span', { class: 'sym', text: c.symbol }),
        el('span', { class: 'card__sub', text: c.name?.slice(0, 32) ?? '' }),
        c.smartWallets > 0
          ? el('span', { class: 'badge badge--series', text: `${c.smartWallets} smart wallet${c.smartWallets > 1 ? 's' : ''}` })
          : null,
        !c.risks.safe ? el('span', { class: 'badge badge--critical', text: 'bloqué' }) : null,
        c.risks.warnings.length ? el('span', { class: 'badge badge--warning', text: `${c.risks.warnings.length} alerte(s)` }) : null,
        el('span', { style: 'margin-left:auto;display:flex;align-items:center;gap:10px' }, [
          meter(c.score),
          el('button', {
            class: eligible ? 'btn btn--sm btn--primary' : 'btn btn--sm',
            text: 'Acheter',
            disabled: !c.risks.safe,
            title: c.risks.safe ? 'Achat manuel' : c.risks.blockers.join(' · '),
            onClick: (e) => ctx.runButton(e.target, api.sniper.buy(c.address), `Achat ${c.symbol} envoyé`),
          }),
        ]),
      ]);

      const facts = el('div', { style: 'display:flex;gap:14px;flex-wrap:wrap;padding:0 14px 11px;font-size:12px' }, [
        fact('Prix', price(c.priceUsd)),
        fact('Liquidité', `${compact(c.liquidityUsd)} $`),
        fact('Market cap', `${compact(c.marketCap)} $`),
        fact('Vol. 1 h', `${compact(c.volumeH1)} $`),
        fact('5 min', signedPct(c.changeM5), pnlClass(c.changeM5)),
        fact('1 h', signedPct(c.changeH1), pnlClass(c.changeH1)),
        fact('Âge', c.ageMinutes === null ? '—' : durationText(c.ageMinutes * 60_000)),
      ]);

      const detail = el('details', { class: 'detail' }, [
        el('summary', { text: `Détail du score ${c.score}${c.smartMoneyBonus ? ` (dont +${c.smartMoneyBonus} smart money)` : ''}` }),
        el('div', {}, [
          el('dl', { class: 'kv' }, c.breakdown.flatMap((b) => [
            el('dt', { text: b.label }),
            el('dd', { text: `${b.points} / ${b.weight}` }),
          ])),
          c.risks.blockers.length
            ? el('div', { class: 'reasons' }, c.risks.blockers.map((r) => el('span', { class: 'neg', text: `⛔ ${r}` })))
            : null,
          c.risks.warnings.length
            ? el('div', { class: 'reasons' }, c.risks.warnings.map((r) => el('span', { class: 'warn', text: `⚠ ${r}` })))
            : null,
          c.url ? el('p', { style: 'margin:10px 0 0' }, [el('a', { href: c.url, target: '_blank', rel: 'noopener', text: 'Voir sur DexScreener ↗' })]) : null,
        ]),
      ]);

      host.append(el('div', { style: 'border-bottom:1px solid var(--border)' }, [header, facts, detail]));
    }
  }

  const fact = (label, value, className = '') =>
    el('span', {}, [
      el('span', { class: 'muted', text: `${label} ` }),
      el('span', { class: className, style: 'font-family:var(--mono)', text: value }),
    ]);

  function renderClosed() {
    const rows = snapshot.closed.map((t) =>
      el('tr', {}, [
        td(el('span', { class: 'sym', text: t.symbol }), { label: 'Token' }),
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
    fillTable($('#snClosed'), rows, { colspan: 7, empty: 'Aucun snipe clôturé.' });
  }

  function renderWallet() {
    for (const button of $('#snModeSwitch').children) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === snapshot.mode));
      button.disabled = button.dataset.mode === 'live' && !snapshot.liveAllowed;
    }

    const host = $('#snWalletInfo');
    host.replaceChildren();

    if (snapshot.wallet.connected) {
      host.append(el('dl', { class: 'kv' }, [
        el('dt', { text: 'Adresse' }),
        el('dd', { text: snapshot.wallet.address }),
        el('dt', { text: 'RPC' }),
        el('dd', { text: snapshot.wallet.rpc }),
      ]));
    } else {
      host.append(el('div', { class: 'banner banner--warning' }, [
        el('span', { class: 'banner__icon', text: '⚠' }),
        el('div', {}, [
          'Wallet non connecté — le sniper scanne et score, mais n\'achète pas. Ajoute ',
          el('code', { text: 'SOLANA_PRIVATE_KEY' }),
          ' (clé Phantom au format bs58) dans les variables d\'environnement Render.',
          snapshot.wallet.reason ? el('div', { class: 'muted', style: 'margin-top:4px', text: snapshot.wallet.reason }) : null,
        ]),
      ]));
    }

    if (!snapshot.wallet.fastRpc) {
      host.append(el('p', { class: 'card__sub', style: 'margin-top:10px' }, [
        'RPC public en cours d\'utilisation : quelques requêtes par seconde seulement. Pour sniper vraiment vite, configure ',
        el('code', { text: 'SOLANA_RPC' }),
        ' avec un endpoint Helius ou QuickNode.',
      ]));
    }

    const sm = snapshot.smartMoney;
    host.append(el('h3', { style: 'font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin:16px 0 8px', text: 'Smart money' }));
    if (!sm.enabled) {
      host.append(el('p', { class: 'card__sub' }, [
        'Aucun wallet suivi. Renseigne ',
        el('code', { text: 'SMART_WALLETS' }),
        ' (adresses séparées par des virgules) pour bonifier le score des tokens qu\'ils achètent.',
      ]));
    } else {
      host.append(el('p', { class: 'card__sub', text: `${sm.tracked} wallet(s) suivis · dernier scan ${sinceText(sm.lastScan)}` }));
      if (sm.hits.length) {
        host.append(el('div', { class: 'reasons' }, sm.hits.slice(0, 10).map((h) =>
          el('span', { text: `${h.mint.slice(0, 5)}… ×${h.wallets}` }),
        )));
      } else {
        host.append(el('p', { class: 'card__sub muted', text: 'Aucun achat détecté sur la fenêtre récente.' }));
      }
    }

    host.append(el('div', { style: 'margin-top:14px' }, [
      el('button', {
        class: 'btn btn--sm',
        text: 'Réinitialiser la démo',
        onClick: (e) => ctx.runButton(e.target, api.sniper.resetDemo(), 'Démo réinitialisée'),
      }),
    ]));
  }

  function renderSettings() {
    const signature = JSON.stringify(snapshot.settings);
    if (signature === settingsSignature) return;
    settingsSignature = signature;

    const s = snapshot.settings;
    const save = (patch) => ctx.run(api.sniper.settings(patch));

    $('#snSettings').replaceChildren(
      toggleField({ label: 'Auto-snipe', checked: s.autoSnipe, onChange: (v) => save({ autoSnipe: v }) }),
      numberField({ label: 'Score minimum', hint: '0-100', value: s.minScore, min: 0, max: 100, onChange: (v) => save({ minScore: v }) }),
      numberField({ label: 'Mise par token', hint: '$', value: s.stakeUsd, min: 1, step: 1, onChange: (v) => save({ stakeUsd: v }) }),
      numberField({ label: 'Slippage', hint: 'points de base', value: s.slippageBps, min: 10, max: 5000, step: 10, onChange: (v) => save({ slippageBps: v }) }),
      numberField({ label: 'Take profit', hint: '%', value: s.takeProfitPct, min: 1, step: 5, onChange: (v) => save({ takeProfitPct: v }) }),
      numberField({ label: 'Stop loss', hint: '%', value: s.stopLossPct, min: 1, step: 5, onChange: (v) => save({ stopLossPct: v }) }),
      numberField({ label: 'Trailing stop', hint: '%', value: s.trailingStopPct, min: 1, step: 5, onChange: (v) => save({ trailingStopPct: v }) }),
      toggleField({ label: 'Activer le trailing stop', checked: s.useTrailingStop, onChange: (v) => save({ useTrailingStop: v }) }),
      numberField({ label: 'Positions simultanées', value: s.maxPositions, min: 1, max: 10, onChange: (v) => save({ maxPositions: v }) }),
      numberField({ label: 'Intervalle de polling', hint: 'secondes', value: s.pollIntervalSec, min: 20, max: 600, step: 10, onChange: (v) => save({ pollIntervalSec: v }) }),
      numberField({ label: 'Bonus par smart wallet', hint: 'points', value: s.smartMoneyBonus, min: 0, max: 25, onChange: (v) => save({ smartMoneyBonus: v }) }),
      toggleField({ label: 'Exiger des réseaux sociaux', checked: s.requireSocials, onChange: (v) => save({ requireSocials: v }) }),
      toggleField({ label: 'Vérifier le déployeur on-chain', checked: s.checkCreator, onChange: (v) => save({ checkCreator: v }) }),
    );
  }

  return { render };
}
