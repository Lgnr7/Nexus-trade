import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, priceOrder, publicProduct, OrderError } from '../catalog.js';

const products = loadCatalog();
const shipping = { freeFrom: 4900, cost: 490 };
const price = (id) => products.find((p) => p.id === id).price;

test('le catalogue se charge avec des prix en centimes entiers', () => {
  assert.ok(products.length > 0);
  for (const p of products) assert.ok(Number.isInteger(p.price));
});

test('le prix vient du catalogue, pas du client', () => {
  const o = priceOrder([{ id: 'plume', qty: 2, color: 0, price: 1 }], products, shipping);
  assert.equal(o.subtotal, price('plume') * 2);
});

test('livraison payante sous le seuil, offerte au-dessus', () => {
  const small = priceOrder([{ id: 'balles', qty: 1 }], products, shipping);
  assert.equal(small.shipping, 490);
  assert.equal(small.total, small.subtotal + 490);
  const big = priceOrder([{ id: 'canopee', qty: 1 }], products, shipping);
  assert.equal(big.shipping, 0);
});

test('fusionne les lignes identiques', () => {
  const o = priceOrder([{ id: 'nuage', qty: 1, color: 1 }, { id: 'nuage', qty: 2, color: 1 }], products, shipping);
  assert.equal(o.lines.length, 1);
  assert.equal(o.lines[0].qty, 3);
});

test('refuse les paniers invalides', () => {
  const bad = [
    [],
    [{ id: 'inconnu', qty: 1 }],
    [{ id: 'plume', qty: 0 }],
    [{ id: 'plume', qty: 1.5 }],
    [{ id: 'plume', qty: 11 }],
    [{ id: 'plume', qty: '2' }],
    [{ id: 'plume', qty: 1, color: 9 }],
    [{ id: 'plume', qty: 6 }, { id: 'plume', qty: 6 }],
  ];
  for (const items of bad) assert.throws(() => priceOrder(items, products, shipping), OrderError, JSON.stringify(items));
});

test('les infos fournisseur ne sortent jamais du serveur', () => {
  for (const p of products.map(publicProduct)) {
    assert.equal(p.supplier, undefined);
    assert.equal(p.active, undefined);
  }
});
