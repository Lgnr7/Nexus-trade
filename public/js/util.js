/** Helpers partagés : formatage FR, création d'éléments, petits composants. */

export const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const nf = (min, max) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: min, maximumFractionDigits: max });

export const money = (n, decimals = 2) =>
  Number.isFinite(n) ? `${nf(decimals, decimals).format(n)} $` : '—';

/** Le signe est toujours explicite : la couleur ne porte jamais seule le sens. */
export const signedMoney = (n, decimals = 2) => {
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${nf(decimals, decimals).format(Math.abs(n))} $`;
};

export const signedPct = (n, decimals = 2) => {
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${nf(decimals, decimals).format(Math.abs(n))} %`;
};

export const pctText = (n, decimals = 1) =>
  Number.isFinite(n) ? `${nf(decimals, decimals).format(n)} %` : '—';

/** Assez de décimales pour lire un memecoin à 0,0000012 $. */
export const price = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '—';
  const abs = Math.abs(v);
  if (abs >= 1000) return nf(2, 2).format(v);
  if (abs >= 1) return nf(2, 4).format(v);
  if (abs >= 0.01) return nf(4, 6).format(v);
  return v.toPrecision(4);
};

export const num = (n, decimals = 2) =>
  Number.isFinite(n) ? nf(0, decimals).format(n) : '—';

export const compact = (n) => {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
};

export const sinceText = (ts) => {
  if (!ts) return '—';
  const d = Date.now() - ts;
  if (d < 5_000) return "à l'instant";
  if (d < 60_000) return `il y a ${Math.round(d / 1000)} s`;
  if (d < 3_600_000) return `il y a ${Math.round(d / 60_000)} min`;
  if (d < 86_400_000) return `il y a ${Math.round(d / 3_600_000)} h`;
  return `il y a ${Math.round(d / 86_400_000)} j`;
};

export const durationText = (ms) => {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)} h`;
  return `${(ms / 86_400_000).toFixed(1)} j`;
};

export const dateTime = (ts) =>
  ts ? new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export const clockTime = (ts) =>
  ts ? new Date(ts).toLocaleTimeString('fr-FR', { hour12: false }) : '';

/** Classe de couleur d'un P&L — toujours accompagnée du signe dans le texte. */
export const pnlClass = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'muted');

/** Jauge de confiance : échelle séquentielle bleue, valeur écrite à côté. */
export function meter(value, max = 100) {
  const ratio = Math.max(0, Math.min(1, (value ?? 0) / max));
  const step = ratio < 0.34 ? 'var(--seq-250)' : ratio < 0.67 ? 'var(--seq-400)' : 'var(--seq-550)';
  return el('div', { class: 'meter' }, [
    el('span', { class: 'meter__track' }, [
      el('span', { class: 'meter__fill', style: `width:${ratio * 100}%;background:${step}` }),
    ]),
    el('span', { class: 'meter__value', text: value === null || value === undefined ? '—' : Math.round(value) }),
  ]);
}

export function emptyRow(colspan, message) {
  return el('tr', {}, [el('td', { colspan, class: 'empty', 'data-label': '' }, [message])]);
}

/** Remplit un <tbody> ; affiche un message si la liste est vide. */
export function fillTable(tbody, rows, { colspan, empty }) {
  tbody.replaceChildren();
  if (!rows.length) {
    tbody.append(emptyRow(colspan, empty));
    return;
  }
  tbody.append(...rows);
}

/** Cellule de tableau ; `label` alimente l'affichage en cartes sur mobile. */
export const td = (content, { label = '', className = '' } = {}) =>
  el('td', { class: className, 'data-label': label }, [content]);

export function numberField({ label, hint, value, min, max, step = 1, onChange }) {
  const input = el('input', { type: 'number', value, min, max, step });
  input.addEventListener('change', () => onChange(Number(input.value)));
  return el('label', { class: 'field' }, [
    el('span', { class: 'field__label' }, [label, hint ? el('small', { text: hint }) : null]),
    input,
  ]);
}

export function toggleField({ label, checked, onChange }) {
  const input = el('input', { type: 'checkbox' });
  input.checked = Boolean(checked);
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'switch' }, [
    input,
    el('span', { class: 'switch__track' }),
    el('span', { text: label }),
  ]);
}

export function selectField({ label, value, options, onChange }) {
  const select = el('select', {});
  for (const opt of options) {
    const option = el('option', { value: opt.value, text: opt.label });
    if (String(opt.value) === String(value)) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', () => onChange(select.value));
  return el('label', { class: 'field' }, [el('span', { class: 'field__label', text: label }), select]);
}
