import { bus } from './bus.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;

// Tout ce qui ressemble à une clé/secret est masqué avant d'atteindre stdout :
// les logs Render sont lisibles par tous ceux qui ont accès au dashboard.
const SECRET_RE = /\b([A-Za-z0-9+/=_-]{32,})\b/g;
const redact = (s) => String(s).replace(SECRET_RE, (m) => `${m.slice(0, 4)}…${m.slice(-4)}`);

const fmt = (level, scope, args) => {
  const ts = new Date().toISOString();
  const body = args
    .map((a) => (typeof a === 'string' ? a : safeJson(a)))
    .join(' ');
  return `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${redact(body)}`;
};

const safeJson = (v) => {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

export function createLogger(scope) {
  const emit = (level, stream) => (...args) => {
    if (LEVELS[level] < threshold) return;
    const line = fmt(level, scope, args);
    stream(line);
    // Le dashboard affiche le même flux que la console Render, déjà caviardé.
    bus.emitLog(level, scope, line.slice(line.indexOf(']') + 2));
  };
  return {
    debug: emit('debug', console.log),
    info: emit('info', console.log),
    warn: emit('warn', console.warn),
    error: emit('error', console.error),
  };
}
