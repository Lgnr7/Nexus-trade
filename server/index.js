import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

import { config } from './config.js';
import { createLogger } from './logger.js';
import { bus } from './bus.js';
import { createRouter } from './api/routes.js';
import { isAuthorized, authEnabled } from './api/auth.js';
import { krakenBot } from './bots/krakenBot.js';
import { sniper } from './bots/solanaSniper.js';
import { riskManager } from './risk/riskManager.js';
import { smartMoney } from './solana/smartMoney.js';
import { wallet } from './solana/wallet.js';
import { notifier } from './alerts/notifier.js';

const log = createLogger('serveur');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Les derniers logs sont conservés en mémoire pour qu'un client qui se
// connecte voie immédiatement ce qui s'est passé, pas un écran vide.
const LOG_BUFFER_SIZE = 300;
const logBuffer = [];
bus.on('log', (entry) => {
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
});

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

app.use((req, res, next) => {
  req.authenticated = isAuthorized(req);
  next();
});

app.use('/api', createRouter());
app.use(express.static(PUBLIC_DIR, { maxAge: '1h', index: 'index.html' }));

// SPA : toute route inconnue hors /api sert l'interface.
app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.use((err, req, res, next) => {
  const status = err.status ?? 500;
  if (status >= 500) log.error(`${req.method} ${req.path}:`, err.stack ?? err.message);
  else log.warn(`${req.method} ${req.path}: ${err.message}`);
  res.status(status).json({ error: err.message ?? 'Erreur interne' });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws')) {
    socket.destroy();
    return;
  }
  // Le flux temps réel expose l'état complet des bots : il est protégé
  // exactement comme l'API REST.
  if (!isAuthorized(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

const send = (ws, type, payload) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, payload, ts: Date.now() }));
};

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', (err) => log.warn('ws:', err.message));

  send(ws, 'snapshot', {
    kraken: krakenBot.snapshot(),
    sniper: sniper.snapshot(),
    risk: riskManager.snapshot(),
    logs: logBuffer.slice(-100),
  });
});

const broadcast = (type, payload) => {
  const frame = JSON.stringify({ type, payload, ts: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(frame);
  }
};

bus.on('state', ({ section, payload }) => broadcast('state', { section, payload }));
bus.on('log', (entry) => broadcast('log', entry));
bus.on('event', (event) => broadcast('event', event));

// Render coupe les connexions inactives : un ping régulier les maintient
// ouvertes et détecte les clients morts.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

async function bootstrap() {
  log.info('─── Nexus Trade v5 ───');
  log.info(`données: ${config.dataDir}`);
  log.info(`trading réel: ${config.allowLiveTrading ? 'AUTORISÉ' : 'bloqué (ALLOW_LIVE_TRADING)'}`);
  if (authEnabled()) log.info('dashboard protégé par mot de passe');
  else log.warn('dashboard sans mot de passe (DASHBOARD_PASSWORD vide)');

  riskManager.init();
  wallet.init();
  notifier.init();

  // Une API indisponible au démarrage ne doit pas empêcher le serveur de
  // répondre : le health check Render échouerait et le service redémarrerait
  // en boucle. Les bots se reconnectent d'eux-mêmes.
  await krakenBot.init().catch((err) => log.error('init Kraken:', err.message));
  sniper.init();
  smartMoney.start();

  // Un port déjà pris doit tuer le process : sinon Render garde une instance
  // vivante mais muette, et le health check ne répond jamais.
  server.on('error', (err) => {
    log.error('serveur HTTP:', err.message);
    process.exit(1);
  });
  server.listen(config.port, () => log.info(`écoute sur le port ${config.port}`));
}

async function shutdown(signal) {
  log.info(`${signal} reçu — arrêt propre`);
  clearInterval(heartbeat);
  krakenBot.stop();
  sniper.stop();
  smartMoney.stop();
  // Les positions ouvertes sont volontairement conservées : elles existent
  // toujours chez Kraken / on-chain après un redéploiement.
  await Promise.allSettled([
    krakenBot.store.flushNow(),
    sniper.store.flushNow(),
    riskManager.store.flushNow(),
  ]);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => log.error('promesse rejetée:', err?.stack ?? err));
process.on('uncaughtException', (err) => log.error('exception non gérée:', err?.stack ?? err));

bootstrap().catch((err) => {
  log.error('démarrage impossible:', err.stack ?? err.message);
  process.exit(1);
});
