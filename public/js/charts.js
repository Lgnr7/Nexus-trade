/**
 * Graphiques SVG inline.
 * Palette validée sur la surface sombre #1a1a19 :
 *   — courbe d'équité : série unique bleue #3987e5, donc pas de légende ;
 *   — barres par tranche de score : échelle divergente bleue ↔ rouge #e66767
 *     avec midpoint neutre, chaque barre portant sa valeur signée en clair
 *     (la couleur ne porte jamais seule l'information).
 */
import { el, money, signedMoney, dateTime } from './util.js';

const NS = 'http://www.w3.org/2000/svg';

const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  return node;
};

const niceTicks = (min, max, count = 4) => {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);
  return ticks;
};

/** Courbe d'équité : aire dégradée + ligne 2 px + curseur au survol. */
export function equityCurve(container, points, { label = 'Équité' } = {}) {
  container.replaceChildren();
  if (!points || points.length < 2) {
    container.append(el('p', { class: 'empty', text: 'Pas encore de données à tracer.' }));
    return;
  }

  // Le viewBox suit la largeur réelle du conteneur : 1 unité = 1 pixel, donc
  // les étiquettes gardent leur taille lisible sur mobile comme sur desktop.
  const W = Math.max(320, Math.round(container.clientWidth) || 1000);
  const H = W < 560 ? 200 : 260;
  const pad = { top: 16, right: 12, bottom: 26, left: 56 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const values = points.map((p) => p.equity);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  // Marge de 6 % pour que la courbe ne colle ni au haut ni au bas du cadre.
  const span = (maxV - minV) || Math.abs(maxV) || 1;
  const lo = minV - span * 0.06;
  const hi = maxV + span * 0.06;

  const x = (i) => pad.left + (i / (points.length - 1)) * innerW;
  const y = (v) => pad.top + innerH - ((v - lo) / (hi - lo)) * innerH;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${label} dans le temps` });

  const defs = svgEl('defs');
  const grad = svgEl('linearGradient', { id: 'equityFade', x1: '0', y1: '0', x2: '0', y2: '1' });
  grad.append(
    svgEl('stop', { offset: '0%', 'stop-color': '#3987e5', 'stop-opacity': '0.28' }),
    svgEl('stop', { offset: '100%', 'stop-color': '#3987e5', 'stop-opacity': '0' }),
  );
  defs.append(grad);
  svg.append(defs);

  // Grille et axe des valeurs, volontairement discrets.
  for (const tick of niceTicks(lo, hi, 4)) {
    const ty = y(tick);
    svg.append(svgEl('line', { class: 'chart__grid', x1: pad.left, x2: W - pad.right, y1: ty, y2: ty }));
    const text = svgEl('text', { class: 'chart__axis', x: pad.left - 8, y: ty + 3, 'text-anchor': 'end' });
    text.textContent = money(tick, 0);
    svg.append(text);
  }

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(' ');
  svg.append(svgEl('path', { class: 'chart__area', d: `${line} L${x(points.length - 1)},${y(lo)} L${x(0)},${y(lo)} Z` }));
  svg.append(svgEl('path', { class: 'chart__line', d: line }));

  // Dates aux deux extrémités : suffisant pour situer, sans encombrer l'axe.
  const first = svgEl('text', { class: 'chart__axis', x: pad.left, y: H - 6 });
  first.textContent = dateTime(points[0].time);
  const last = svgEl('text', { class: 'chart__axis', x: W - pad.right, y: H - 6, 'text-anchor': 'end' });
  last.textContent = dateTime(points[points.length - 1].time);
  svg.append(first, last);

  const crosshair = svgEl('line', { class: 'chart__crosshair', y1: pad.top, y2: pad.top + innerH, opacity: 0 });
  const marker = svgEl('circle', { class: 'chart__marker', r: 4.5, opacity: 0 });
  svg.append(crosshair, marker);

  container.append(svg);
  const tooltip = el('div', { class: 'tooltip' });
  container.append(tooltip);

  const move = (event) => {
    const rect = svg.getBoundingClientRect();
    const clientX = event.touches?.[0]?.clientX ?? event.clientX;
    const ratio = (clientX - rect.left) / rect.width;
    const index = Math.round(Math.max(0, Math.min(1, (ratio * W - pad.left) / innerW)) * (points.length - 1));
    const point = points[index];
    if (!point) return;

    crosshair.setAttribute('x1', x(index));
    crosshair.setAttribute('x2', x(index));
    crosshair.setAttribute('opacity', 1);
    marker.setAttribute('cx', x(index));
    marker.setAttribute('cy', y(point.equity));
    marker.setAttribute('opacity', 1);

    tooltip.replaceChildren(
      el('div', { class: 'tooltip__label', text: dateTime(point.time) }),
      el('div', { text: money(point.equity) }),
    );
    tooltip.dataset.visible = 'true';
    tooltip.style.left = `${(x(index) / W) * rect.width}px`;
    tooltip.style.top = `${(y(point.equity) / H) * rect.height}px`;
  };

  const hide = () => {
    crosshair.setAttribute('opacity', 0);
    marker.setAttribute('opacity', 0);
    tooltip.dataset.visible = 'false';
  };

  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('touchmove', move, { passive: true });
  svg.addEventListener('touchend', hide);
}

/**
 * P&L moyen par tranche de score. Échelle divergente autour de zéro :
 * bleu = gain, rouge = perte, ligne de base neutre. Chaque barre est
 * étiquetée avec sa valeur signée.
 */
export function bracketChart(container, brackets) {
  container.replaceChildren();
  const usable = brackets.filter((b) => b.trades > 0);
  if (!usable.length) {
    container.append(el('p', { class: 'empty', text: 'Pas encore de trades à analyser.' }));
    return;
  }

  const W = Math.max(320, Math.round(container.clientWidth) || 1000);
  const H = W < 560 ? 190 : 220;
  const pad = { top: 22, right: 8, bottom: 32, left: 12 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const values = usable.map((b) => b.avgPnl ?? 0);
  const maxAbs = Math.max(...values.map(Math.abs), 1);
  const zeroY = pad.top + innerH / 2;
  const scale = (v) => (v / maxAbs) * (innerH / 2);

  // Gouttière entre barres adjacentes, comme le veut la spec de marque.
  const slot = innerW / usable.length;
  const barW = Math.max(8, slot - (W < 560 ? 6 : 10));

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'P&L moyen par tranche de score' });

  svg.append(svgEl('line', {
    x1: pad.left, x2: W - pad.right, y1: zeroY, y2: zeroY,
    stroke: '#46463f', 'stroke-width': 1,
  }));

  const tooltip = el('div', { class: 'tooltip' });

  usable.forEach((bracket, i) => {
    const value = bracket.avgPnl ?? 0;
    const height = Math.abs(scale(value));
    const cx = pad.left + slot * i + slot / 2;
    const bx = cx - barW / 2;
    const by = value >= 0 ? zeroY - height : zeroY;
    const positive = value >= 0;

    const bar = svgEl('path', {
      // Seul le bout « valeur » est arrondi ; le pied reste collé à la
      // ligne de base, comme le veut la spec des marques.
      d: barPath(bx, by, barW, Math.max(height, 2), positive),
      fill: positive ? '#3987e5' : '#e66767',
      // Une tranche peu fournie est dessinée en creux : le chiffre existe,
      // mais il ne faut pas le lire comme un résultat établi.
      opacity: bracket.reliable ? 1 : 0.45,
    });
    svg.append(bar);

    if (barW >= 34) {
      const label = svgEl('text', {
        class: 'chart__axis',
        x: cx,
        y: positive ? by - 6 : by + height + 13,
        'text-anchor': 'middle',
        fill: '#c3c2b7',
      });
      label.textContent = signedMoney(value, 0);
      svg.append(label);
    }

    const axis = svgEl('text', { class: 'chart__axis', x: cx, y: H - 8, 'text-anchor': 'middle' });
    axis.textContent = bracket.label;
    svg.append(axis);

    const show = () => {
      tooltip.replaceChildren(
        el('div', { class: 'tooltip__label', text: `Score ${bracket.label}` }),
        el('div', { text: `${bracket.trades} trades · ${bracket.winRate ?? '—'} % gagnants` }),
        el('div', { text: `Moyenne ${signedMoney(value)} · total ${signedMoney(bracket.totalPnl)}` }),
        bracket.reliable ? null : el('div', { class: 'tooltip__label', text: 'échantillon insuffisant' }),
      );
      tooltip.dataset.visible = 'true';
      const rectBox = svg.getBoundingClientRect();
      tooltip.style.left = `${(cx / W) * rectBox.width}px`;
      tooltip.style.top = `${(Math.min(by, zeroY) / H) * rectBox.height}px`;
    };

    // Zone de survol pleine hauteur : la cible reste atteignable même quand
    // la barre est minuscule.
    const hit = svgEl('rect', {
      x: bx - 4, y: pad.top, width: barW + 8, height: innerH, fill: 'transparent',
    });
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerleave', () => { tooltip.dataset.visible = 'false'; });
    svg.append(hit);
  });

  container.append(svg, tooltip);
}

/** Barre à un seul bout arrondi (4 px), l'autre ancré à la ligne de base. */
function barPath(x, y, w, h, up) {
  const r = Math.min(4, w / 2, h);
  return up
    ? `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`
    : `M${x},${y} L${x},${y + h - r} Q${x},${y + h} ${x + r},${y + h} L${x + w - r},${y + h} Q${x + w},${y + h} ${x + w},${y + h - r} L${x + w},${y} Z`;
}
