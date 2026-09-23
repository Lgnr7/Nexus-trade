import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CATALOG_PATH = path.join(__dirname, 'data', 'products.json');

export const MAX_QTY_PER_LINE = 10;
export const MAX_LINES = 30;

export function loadCatalog(file = CATALOG_PATH) {
  const products = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ids = new Set();
  for (const p of products) {
    if (ids.has(p.id)) throw new Error(`Produit en double dans le catalogue : ${p.id}`);
    ids.add(p.id);
    if (!Number.isInteger(p.price) || p.price <= 0) throw new Error(`Prix invalide pour ${p.id} (attendu : centimes entiers)`);
    if (!Array.isArray(p.colors) || !p.colors.length) throw new Error(`Aucun coloris pour ${p.id}`);
  }
  return products;
}

// Ce que le navigateur a le droit de voir : jamais le fournisseur ni le coût
// d'achat.
export function publicProduct(p) {
  const { supplier, active, ...rest } = p;
  return rest;
}

export class OrderError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// Recalcule une commande à partir du catalogue du serveur. Le panier envoyé
// par le navigateur ne fournit que des identifiants et des quantités : le
// prix vient toujours d'ici, jamais du client.
export function priceOrder(items, products, shipping) {
  if (!Array.isArray(items) || items.length === 0) throw new OrderError('Le panier est vide.');
  if (items.length > MAX_LINES) throw new OrderError('Trop de lignes dans le panier.');

  const byId = new Map(products.map((p) => [p.id, p]));
  const merged = new Map();
  for (const it of items) {
    const p = byId.get(it?.id);
    if (!p || !p.active) throw new OrderError(`Produit indisponible : ${String(it?.id).slice(0, 40)}`);
    const qty = it.qty;
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
      throw new OrderError(`Quantité invalide pour ${p.name} (entre 1 et ${MAX_QTY_PER_LINE}).`);
    }
    const color = it.color ?? 0;
    if (!Number.isInteger(color) || color < 0 || color >= p.colors.length) {
      throw new OrderError(`Coloris invalide pour ${p.name}.`);
    }
    const key = `${p.id}:${color}`;
    const prev = merged.get(key);
    const total = (prev?.qty ?? 0) + qty;
    if (total > MAX_QTY_PER_LINE) throw new OrderError(`Quantité maximale dépassée pour ${p.name}.`);
    merged.set(key, { product: p, color, qty: total });
  }

  const lines = [...merged.values()].map(({ product, color, qty }) => ({
    id: product.id,
    name: product.name,
    colorLabel: product.colors[color].label,
    color,
    qty,
    unitPrice: product.price,
    total: product.price * qty,
  }));
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const shippingCost = subtotal >= shipping.freeFrom ? 0 : shipping.cost;
  return { lines, subtotal, shipping: shippingCost, total: subtotal + shippingCost };
}
