import { api, connectLive } from './api.js';
import { $, $$, el, money, signedMoney, pnlClass } from './util.js';
import { createKrakenView } from './views/kraken.js';
import { createSniperView } from './views/sniper.js';
import { createRiskView } from './views/risk.js';
import { createPortfolioView } from './views/portfolio.js';
import { createBacktestView } from './views/backtest.js';
import { createLogsView } from './views/logs.js';

/* ─── Toasts ─────────────────────────────────────────────────────────────── */

function toast(message, tone = 'info', ms = 4200) {
  const node = el('div', { class: `toast toast--${tone}`, text: message });
  $('#toasts').append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 200);
  }, ms);
}

/* ─── Confirmation ───────────────────────────────────────────────────────── */

function confirmDialog({ title, text, onConfirm }) {
  const modal = $('#confirmModal');
  $('#confirmTitle').textContent = title;
  $('#confirmText').textContent = text;
  modal.hidden = false;
  document.body.classList.add('locked');

  const close = () => {
    modal.hidden = true;
    document.body.classList.remove('locked');
    $('#confirmOk').replaceWith($('#confirmOk').cloneNode(true));
    $('#confirmCancel').replaceWith($('#confirmCancel').cloneNode(true));
  };

  $('#confirmCancel').addEventListener('click', close, { once: true });
  $('#confirmOk').addEventListener('click', () => {
    close();
    onConfirm();
  }, { once: true });
}

/* ─── Contexte partagé par les vues ──────────────────────────────────────── */

const ctx = {
  toast,
  confirm: confirmDialog,

  /** Exécute une promesse d'API et affiche l'erreur éventuelle. */
  async run(promise, successMessage) {
    try {
      const result = await promise;
      if (successMessage) toast(successMessage, 'good');
      return result;
    } catch (err) {
      toast(err.message, 'critical', 6000);
      return null;
    }
  },

  /** Idem, en désactivant le bouton déclencheur le temps de l'appel. */
  async runButton(button, promise, successMessage) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = '…';
    try {
      return await ctx.run(promise, successMessage);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  },

  setBadge(name, count) {
    const badge = $(name === 'kraken' ? '#badgeKraken' : '#badgeSniper');
    badge.textContent = String(count);
    badge.hidden = count === 0;
  },

  setTopStats({ equity, pnl }) {
    if (Number.isFinite(equity)) $('#topEquity').textContent = money(equity, 0);
    if (Number.isFinite(pnl)) {
      const node = $('#topPnl');
      node.textContent = signedMoney(pnl, 0);
      node.className = `ministat__value ${pnlClass(pnl)}`;
    }
  },
};

/* ─── Vues ───────────────────────────────────────────────────────────────── */

const views = {
  kraken: createKrakenView(ctx),
  sniper: createSniperView(ctx),
  risk: createRiskView(ctx),
  portfolio: createPortfolioView(ctx),
  backtest: createBacktestView(ctx),
  logs: createLogsView(),
};

let current = 'kraken';

function showView(name) {
  current = name;
  for (const tab of $$('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.view === name));
  }
  for (const view of $$('.view')) {
    view.hidden = view.id !== `view-${name}`;
  }
  localStorage.setItem('nexus.view', name);
  // Les onglets coûteux ne sont chargés qu'à l'ouverture, pas en continu.
  if (name === 'risk') views.risk.refresh().catch((err) => toast(err.message, 'critical'));
  if (name === 'portfolio') views.portfolio.refresh().catch((err) => toast(err.message, 'critical'));
}

for (const tab of $$('.tab')) {
  tab.addEventListener('click', () => showView(tab.dataset.view));
}

/* ─── Bannières d'état ───────────────────────────────────────────────────── */

let lastBannerKey = '';

function renderBanners(state) {
  const items = [];

  if (state.risk.halted) {
    items.push({
      tone: 'critical',
      icon: '⛔',
      text: `Trading coupé — ${state.risk.haltReason}. Rends-toi dans « Risk & apprentissage » pour réautoriser.`,
    });
  }
  if (!state.kraken.connection.ok) {
    items.push({ tone: 'warning', icon: '⚠', text: `Kraken injoignable : ${state.kraken.connection.message}` });
  }
  if (state.kraken.mode === 'live' || state.sniper.mode === 'live') {
    const which = [state.kraken.mode === 'live' && 'bot Kraken', state.sniper.mode === 'live' && 'sniper Solana']
      .filter(Boolean)
      .join(' et ');
    items.push({ tone: 'critical', icon: '●', text: `Mode LIVE actif sur le ${which} — les ordres engagent de l'argent réel.` });
  }
  if (state.sniper.lastError) {
    items.push({ tone: 'warning', icon: '⚠', text: `Sniper : ${state.sniper.lastError}` });
  }

  // Ne reconstruire que si le contenu change : sinon la bannière « clignote »
  // à chaque trame WebSocket.
  const key = JSON.stringify(items);
  if (key === lastBannerKey) return;
  lastBannerKey = key;

  $('#banners').replaceChildren(
    ...items.map((item) =>
      el('div', { class: `banner banner--${item.tone}` }, [
        el('span', { class: 'banner__icon', text: item.icon }),
        el('div', { text: item.text }),
      ]),
    ),
  );
}

/* ─── Application de l'état ──────────────────────────────────────────────── */

const state = { kraken: null, sniper: null, risk: null };

function applyState(partial) {
  Object.assign(state, partial);
  if (state.kraken) views.kraken.render(state.kraken);
  if (state.sniper) views.sniper.render(state.sniper);
  if (state.risk) views.risk.render(state.risk);

  if (state.kraken && state.sniper) {
    const positions = state.kraken.positions.length + state.sniper.positions.length;
    $('#topPositions').textContent = String(positions);
    // L'équité complète vient de l'onglet Portefeuille ; en attendant, on
    // affiche la somme des soldes démo pour ne pas laisser un tiret.
    if ($('#topEquity').textContent === '—') {
      ctx.setTopStats({
        equity: state.kraken.equity + state.sniper.demoBalance,
        pnl: state.kraken.openPnl + state.sniper.openPnl + (state.risk?.realizedPnl ?? 0),
      });
    } else {
      ctx.setTopStats({
        pnl: state.kraken.openPnl + state.sniper.openPnl + (state.risk?.realizedPnl ?? 0),
      });
    }
    renderBanners(state);
  }
}

/* ─── Temps réel ─────────────────────────────────────────────────────────── */

const EVENT_TONE = {
  'kraken:entry': 'info',
  'kraken:exit': 'good',
  'sniper:entry': 'info',
  'sniper:exit': 'good',
  'risk:halt': 'critical',
  'kraken:order-failed': 'critical',
  'sniper:sell-failed': 'critical',
};

function describeEvent({ type, payload }) {
  switch (type) {
    case 'kraken:entry': return `Achat ${payload.symbol} — ${money(payload.size)} (score ${payload.score})`;
    case 'kraken:exit': return `Vente ${payload.symbol} — ${signedMoney(payload.pnl)} (${payload.reason})`;
    case 'sniper:entry': return `Snipe ${payload.symbol} — ${money(payload.size)} (score ${payload.score})`;
    case 'sniper:exit': return `Sortie ${payload.symbol} — ${signedMoney(payload.pnl)} (${payload.reason})`;
    case 'risk:halt': return `Trading coupé : ${payload.reason}`;
    case 'kraken:order-failed':
    case 'sniper:sell-failed': return `Ordre refusé ${payload.symbol} : ${payload.error}`;
    default: return null;
  }
}

function startLive() {
  connectLive({
    onStatus: (status) => { $('#connDot').dataset.status = status; },
    onMessage: (frame) => {
      if (frame.type === 'snapshot') {
        applyState({ kraken: frame.payload.kraken, sniper: frame.payload.sniper, risk: frame.payload.risk });
        views.logs.replaceAll(frame.payload.logs ?? []);
      } else if (frame.type === 'state') {
        applyState({ [frame.payload.section]: frame.payload.payload });
      } else if (frame.type === 'log') {
        views.logs.append(frame.payload);
      } else if (frame.type === 'event') {
        const message = describeEvent(frame.payload);
        if (message) {
          const tone = frame.payload.payload?.pnl < 0 ? 'warning' : (EVENT_TONE[frame.payload.type] ?? 'info');
          toast(message, tone);
        }
        // Une entrée ou une sortie change les soldes réels : on rafraîchit
        // le portefeuille s'il est à l'écran.
        if (current === 'portfolio') views.portfolio.refresh().catch(() => {});
        if (current === 'risk') views.risk.refresh().catch(() => {});
      }
    },
  });
}

/* ─── Démarrage ──────────────────────────────────────────────────────────── */

async function boot() {
  const session = await api.session();
  if (session.authRequired && !session.authenticated) {
    showLogin();
    return;
  }
  $('#loginModal').hidden = true;
  document.body.classList.remove('locked');

  showView(localStorage.getItem('nexus.view') ?? 'kraken');

  try {
    const initial = await api.state();
    applyState({ kraken: initial.kraken, sniper: initial.sniper, risk: initial.risk });
  } catch (err) {
    toast(`État initial indisponible : ${err.message}`, 'critical', 8000);
  }

  startLive();
  views.portfolio.refresh().catch(() => {});

  // Les graphiques dimensionnent leur viewBox sur la largeur du conteneur :
  // un changement d'orientation ou de fenêtre demande un nouveau rendu.
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (current === 'risk') views.risk.refresh().catch(() => {});
    }, 250);
  });

  // Les libellés « il y a N s » ne se mettent pas à jour tout seuls entre
  // deux trames : un rafraîchissement léger toutes les 10 s suffit.
  setInterval(() => {
    if (state.kraken) views.kraken.render(state.kraken);
    if (state.sniper) views.sniper.render(state.sniper);
  }, 10_000);
}

function showLogin() {
  const modal = $('#loginModal');
  modal.hidden = false;
  document.body.classList.add('locked');
  $('#loginPassword').focus();

  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('#loginError');
    error.hidden = true;
    try {
      await api.login($('#loginPassword').value);
      modal.hidden = true;
      document.body.classList.remove('locked');
      boot();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
}

boot().catch((err) => toast(`Démarrage impossible : ${err.message}`, 'critical', 10_000));
