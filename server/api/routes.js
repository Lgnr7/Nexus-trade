import express from 'express';
import { krakenBot } from '../bots/krakenBot.js';
import { sniper } from '../bots/solanaSniper.js';
import { riskManager } from '../risk/riskManager.js';
import { analyse } from '../risk/learning.js';
import { buildPortfolio } from '../portfolio.js';
import { backtestAll, backtestPair } from '../backtest/engine.js';
import { notifier } from '../alerts/notifier.js';
import { smartMoney } from '../solana/smartMoney.js';
import { wallet } from '../solana/wallet.js';
import { kraken, WATCHED_PAIRS } from '../exchanges/kraken.js';
import { config } from '../config.js';
import { requireAuth, login, logout, authEnabled } from './auth.js';
import { createLogger } from '../logger.js';

const log = createLogger('api');

/** Enveloppe les handlers async : sans ça une promesse rejetée fait un 500 muet. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createRouter() {
  const router = express.Router();

  // ─── Public ───────────────────────────────────────────────────────────────
  router.get('/health', (req, res) => {
    res.json({
      ok: true,
      uptime: Math.round(process.uptime()),
      version: '5.0.0',
      krakenBot: krakenBot.store.data.running,
      sniper: sniper.store.data.running,
    });
  });

  router.get('/session', (req, res) => {
    res.json({ authRequired: authEnabled(), authenticated: req.authenticated ?? !authEnabled() });
  });

  router.post('/login', login);
  router.post('/logout', logout);

  // ─── Protégé ──────────────────────────────────────────────────────────────
  router.use(requireAuth);

  router.get('/state', wrap(async (req, res) => {
    res.json({
      kraken: krakenBot.snapshot(),
      sniper: sniper.snapshot(),
      risk: riskManager.snapshot(),
      config: {
        liveAllowed: config.allowLiveTrading,
        krakenKeys: kraken.configured,
        solanaWallet: wallet.status,
        alerts: notifier.channels,
        authRequired: authEnabled(),
      },
    });
  }));

  // ── Bot Kraken ──
  router.get('/kraken', (req, res) => res.json(krakenBot.snapshot()));
  router.get('/kraken/pairs', (req, res) => res.json(WATCHED_PAIRS));

  router.post('/kraken/start', (req, res) => {
    krakenBot.start();
    res.json(krakenBot.snapshot());
  });

  router.post('/kraken/stop', (req, res) => {
    krakenBot.stop();
    res.json(krakenBot.snapshot());
  });

  router.post('/kraken/scan', wrap(async (req, res) => {
    await krakenBot.tick();
    res.json(krakenBot.snapshot());
  }));

  router.post('/kraken/settings', (req, res) => {
    res.json(krakenBot.setSettings(req.body ?? {}));
  });

  router.post('/kraken/mode', (req, res) => {
    res.json({ mode: krakenBot.setMode(req.body?.mode) });
  });

  router.post('/kraken/reconnect', wrap(async (req, res) => {
    res.json(await krakenBot.reconnect());
  }));

  router.post('/kraken/buy', wrap(async (req, res) => {
    const altname = String(req.body?.altname ?? '');
    const market = krakenBot.market.get(altname);
    if (!market) return res.status(404).json({ error: 'Paire non scannée pour le moment' });
    const size = Number(req.body?.size ?? krakenBot.settings.stake);
    const verdict = riskManager.check({
      venue: 'kraken',
      requestedSize: size,
      openPositions: krakenBot.snapshot().positions.length,
    });
    if (!verdict.ok) return res.status(409).json({ error: verdict.reason });
    const position = await krakenBot.openPosition(market, verdict.size);
    if (!position) return res.status(502).json({ error: 'Ordre refusé — voir les logs' });
    res.json(position);
  }));

  router.post('/kraken/close', wrap(async (req, res) => {
    const closed = await krakenBot.closePosition(String(req.body?.id ?? ''), 'manuelle');
    if (!closed) return res.status(404).json({ error: 'Position introuvable ou vente refusée' });
    res.json(closed);
  }));

  router.post('/kraken/close-all', wrap(async (req, res) => {
    res.json(await krakenBot.closeAll('fermeture manuelle'));
  }));

  router.post('/kraken/reset-demo', (req, res) => {
    krakenBot.resetDemo();
    res.json(krakenBot.snapshot());
  });

  // ── Sniper Solana ──
  router.get('/sniper', (req, res) => res.json(sniper.snapshot()));

  router.post('/sniper/start', (req, res) => {
    sniper.start();
    res.json(sniper.snapshot());
  });

  router.post('/sniper/stop', (req, res) => {
    sniper.stop();
    res.json(sniper.snapshot());
  });

  router.post('/sniper/scan', wrap(async (req, res) => {
    await sniper.tick();
    res.json(sniper.snapshot());
  }));

  router.post('/sniper/settings', (req, res) => {
    res.json(sniper.setSettings(req.body ?? {}));
  });

  router.post('/sniper/mode', (req, res) => {
    res.json({ mode: sniper.setMode(req.body?.mode) });
  });

  router.post('/sniper/buy', wrap(async (req, res) => {
    const address = String(req.body?.address ?? '');
    const size = Number(req.body?.size ?? sniper.settings.stakeUsd);
    const verdict = riskManager.check({
      venue: 'solana',
      requestedSize: size,
      openPositions: sniper.snapshot().positions.length,
    });
    if (!verdict.ok) return res.status(409).json({ error: verdict.reason });
    res.json(await sniper.buy(address, verdict.size, 'manuel'));
  }));

  router.post('/sniper/sell', wrap(async (req, res) => {
    res.json(await sniper.sell(String(req.body?.id ?? ''), 'manuelle'));
  }));

  router.post('/sniper/sell-all', wrap(async (req, res) => {
    res.json(await sniper.sellAll('fermeture manuelle'));
  }));

  router.post('/sniper/reset-demo', (req, res) => {
    sniper.resetDemo();
    res.json(sniper.snapshot());
  });

  router.get('/sniper/smart-money', (req, res) => res.json(smartMoney.snapshot()));

  router.post('/sniper/smart-money/scan', wrap(async (req, res) => {
    await smartMoney.scan();
    res.json(smartMoney.snapshot());
  }));

  // ── Risk manager & apprentissage ──
  router.get('/risk', (req, res) => res.json(riskManager.snapshot()));

  router.post('/risk/limits', (req, res) => {
    res.json(riskManager.setLimits(req.body ?? {}));
  });

  router.post('/risk/resume', (req, res) => {
    riskManager.resume();
    res.json(riskManager.snapshot());
  });

  router.post('/risk/panic', wrap(async (req, res) => {
    // Bouton d'urgence : on coupe d'abord, on ferme ensuite. Si une vente
    // échoue, le trading reste coupé de toute façon.
    riskManager.halt('arrêt d\'urgence manuel');
    krakenBot.stop();
    sniper.stop();
    const [krakenClosed, sniperClosed] = await Promise.all([
      krakenBot.closeAll('arrêt d\'urgence'),
      sniper.sellAll('arrêt d\'urgence'),
    ]);
    log.warn('ARRÊT D\'URGENCE déclenché depuis l\'interface');
    res.json({ krakenClosed: krakenClosed.length, sniperClosed: sniperClosed.length });
  }));

  router.get('/learning', (req, res) => {
    const minSamples = Number(req.query.minSamples ?? 5);
    res.json(analyse(riskManager.state.history, { minSamples }));
  });

  router.get('/history', (req, res) => {
    const venue = req.query.venue;
    const history = riskManager.state.history.filter((t) => !venue || t.venue === venue);
    res.json(history.slice(-200).reverse());
  });

  // ── Portefeuille ──
  router.get('/portfolio', wrap(async (req, res) => {
    res.json(await buildPortfolio());
  }));

  // ── Backtests ──
  router.post('/backtest', wrap(async (req, res) => {
    const { pairs, interval, settings, startEquity } = req.body ?? {};
    const report = await backtestAll({
      pairs: Array.isArray(pairs) && pairs.length ? pairs : undefined,
      interval: interval ? Number(interval) : undefined,
      settings: settings ?? {},
      startEquity: startEquity ? Number(startEquity) : 1_000,
    });
    res.json(report);
  }));

  router.post('/backtest/pair', wrap(async (req, res) => {
    const altname = String(req.body?.altname ?? '');
    if (!WATCHED_PAIRS.some((p) => p.altname === altname)) {
      return res.status(400).json({ error: 'Paire non suivie' });
    }
    await kraken.loadPairs().catch(() => {});
    const result = await backtestPair(altname, {
      interval: req.body?.interval ? Number(req.body.interval) : undefined,
      settings: req.body?.settings ?? {},
      startEquity: Number(req.body?.startEquity ?? 1_000),
    });
    res.json(result);
  }));

  // ── Alertes ──
  router.get('/alerts', (req, res) => res.json(notifier.channels));
  router.post('/alerts/test', wrap(async (req, res) => {
    res.json(await notifier.test());
  }));

  return router;
}
