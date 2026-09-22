import crypto from 'node:crypto';
import { config } from '../config.js';

const COOKIE = 'nexus_auth';

/**
 * Authentification minimale par mot de passe partagé. Le cookie ne contient
 * pas le mot de passe mais un HMAC dérivé : intercepter le cookie ne révèle
 * donc pas le secret. Suffisant pour protéger un dashboard personnel ;
 * ce n'est pas un système multi-utilisateurs.
 */
const token = () =>
  crypto.createHmac('sha256', config.dashboardPassword).update('nexus-dashboard-v5').digest('hex');

export const authEnabled = () => Boolean(config.dashboardPassword);

const readCookie = (req, name) => {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
};

export function isAuthorized(req) {
  if (!authEnabled()) return true;
  const provided = readCookie(req, COOKIE) ?? bearer(req);
  if (!provided) return false;
  const expected = token();
  // Comparaison à temps constant : évite de fuiter le token octet par octet.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const bearer = (req) => {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
};

export function requireAuth(req, res, next) {
  if (isAuthorized(req)) return next();
  return res.status(401).json({ error: 'Authentification requise' });
}

export function login(req, res) {
  if (!authEnabled()) return res.json({ ok: true, authRequired: false });
  const password = String(req.body?.password ?? '');
  const expected = Buffer.from(config.dashboardPassword);
  const given = Buffer.from(password);
  const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
  if (!ok) return res.status(401).json({ error: 'Mot de passe incorrect' });

  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 86400}${
      process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`,
  );
  return res.json({ ok: true, authRequired: true });
}

export function logout(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.json({ ok: true });
}
