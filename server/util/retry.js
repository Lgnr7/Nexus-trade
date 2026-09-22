import { sleep } from './time.js';

/**
 * Relance une promesse avec backoff exponentiel.
 * Les erreurs marquées `fatal` ne sont jamais réessayées (clé API invalide,
 * fonds insuffisants… : réessayer ne ferait qu'empiler les appels).
 */
export async function withRetry(fn, { attempts = 3, baseDelay = 500, onRetry } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn(i);
    } catch (err) {
      lastError = err;
      if (err?.fatal || i === attempts - 1) break;
      const delay = baseDelay * 2 ** i;
      onRetry?.(err, i + 1, delay);
      await sleep(delay);
    }
  }
  throw lastError;
}

/** fetch avec timeout : sans ça un RPC qui ne répond jamais bloque la boucle. */
export async function fetchJson(url, { timeout = 15_000, ...options } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      // L'URL complète d'une requête Kraken/DexScreener fait plusieurs
      // centaines de caractères : illisible dans une bannière d'interface.
      const shortUrl = String(url).split('?')[0];
      const err = new Error(`HTTP ${res.status} ${shortUrl} — ${String(text).slice(0, 140)}`);
      err.status = res.status;
      err.body = body;
      // 4xx hors rate-limit : la requête est mauvaise, pas la connexion.
      err.fatal = res.status >= 400 && res.status < 500 && res.status !== 429;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}
