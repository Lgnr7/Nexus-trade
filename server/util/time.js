export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const now = () => Date.now();

/** Clé de jour UTC, utilisée pour remettre à zéro les compteurs journaliers. */
export const dayKey = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);

export const minutes = (n) => n * 60_000;
export const seconds = (n) => n * 1000;

export const ago = (ts) => {
  const d = Date.now() - ts;
  if (d < 60_000) return `${Math.round(d / 1000)}s`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)}min`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h`;
  return `${Math.round(d / 86_400_000)}j`;
};
