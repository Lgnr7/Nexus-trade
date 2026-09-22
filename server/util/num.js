export const round = (n, decimals = 2) => {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export const pct = (from, to) => (from === 0 ? 0 : ((to - from) / from) * 100);

export const sum = (arr) => arr.reduce((a, b) => a + b, 0);

export const avg = (arr) => (arr.length === 0 ? 0 : sum(arr) / arr.length);

export const stdev = (arr) => {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(sum(arr.map((v) => (v - m) ** 2)) / arr.length);
};

/** Formate un prix avec assez de décimales pour rester lisible sur un memecoin. */
export const fmtPrice = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(2);
  if (abs >= 1) return v.toFixed(4);
  if (abs >= 0.01) return v.toFixed(6);
  return v.toPrecision(4);
};
