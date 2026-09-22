/** Client REST + WebSocket. Toute erreur serveur remonte avec son message. */

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const error = new Error(data?.error ?? `Erreur ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

const get = (path) => request(path);
const post = (path, body) => request(path, { method: 'POST', body });

export const api = {
  session: () => get('/session'),
  login: (password) => post('/login', { password }),
  logout: () => post('/logout'),
  state: () => get('/state'),

  kraken: {
    get: () => get('/kraken'),
    start: () => post('/kraken/start'),
    stop: () => post('/kraken/stop'),
    scan: () => post('/kraken/scan'),
    settings: (patch) => post('/kraken/settings', patch),
    mode: (mode) => post('/kraken/mode', { mode }),
    reconnect: () => post('/kraken/reconnect'),
    buy: (altname, size) => post('/kraken/buy', { altname, size }),
    close: (id) => post('/kraken/close', { id }),
    closeAll: () => post('/kraken/close-all'),
    resetDemo: () => post('/kraken/reset-demo'),
  },

  sniper: {
    get: () => get('/sniper'),
    start: () => post('/sniper/start'),
    stop: () => post('/sniper/stop'),
    scan: () => post('/sniper/scan'),
    settings: (patch) => post('/sniper/settings', patch),
    mode: (mode) => post('/sniper/mode', { mode }),
    buy: (address, size) => post('/sniper/buy', { address, size }),
    sell: (id) => post('/sniper/sell', { id }),
    sellAll: () => post('/sniper/sell-all'),
    resetDemo: () => post('/sniper/reset-demo'),
    smartMoneyScan: () => post('/sniper/smart-money/scan'),
  },

  risk: {
    get: () => get('/risk'),
    limits: (patch) => post('/risk/limits', patch),
    resume: () => post('/risk/resume'),
    panic: () => post('/risk/panic'),
  },

  learning: (minSamples = 5) => get(`/learning?minSamples=${minSamples}`),
  history: (venue) => get(`/history${venue ? `?venue=${venue}` : ''}`),
  portfolio: () => get('/portfolio'),
  backtest: (payload) => post('/backtest', payload),
  alertsTest: () => post('/alerts/test'),
};

/**
 * Connexion temps réel avec reconnexion automatique à délai croissant :
 * Render coupe les instances free tier, le dashboard doit se rattraper seul.
 */
export function connectLive({ onMessage, onStatus }) {
  let socket = null;
  let attempt = 0;
  let closed = false;

  const open = () => {
    if (closed) return;
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${protocol}://${location.host}/ws`);

    socket.addEventListener('open', () => {
      attempt = 0;
      onStatus('on');
    });
    socket.addEventListener('message', (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch {
        /* trame illisible : on l'ignore plutôt que de casser le flux */
      }
    });
    socket.addEventListener('close', () => {
      onStatus('off');
      if (closed) return;
      attempt += 1;
      setTimeout(open, Math.min(1000 * 2 ** attempt, 15_000));
    });
    socket.addEventListener('error', () => onStatus('err'));
  };

  open();
  return {
    close() {
      closed = true;
      socket?.close();
    },
  };
}
