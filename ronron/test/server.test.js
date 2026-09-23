import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.STRIPE_SECRET_KEY;
const { app } = await import('../server.js');

let server, base;
before(() => new Promise((ok) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; ok(); }); }));
after(() => server.close());

const post = (body) => fetch(`${base}/api/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('GET /api/store expose le catalogue public en mode démo', async () => {
  const r = await fetch(`${base}/api/store`);
  const data = await r.json();
  assert.equal(data.payments, 'demo');
  assert.ok(data.products.length > 0);
  assert.ok(data.products.every((p) => !('supplier' in p)));
});

test('la commande exige l\'acceptation des CGV', async () => {
  const r = await post({ items: [{ id: 'plume', qty: 1 }] });
  assert.equal(r.status, 400);
});

test('commande de démonstration recalculée côté serveur', async () => {
  const r = await post({ acceptTerms: true, items: [{ id: 'plume', qty: 1, color: 0 }] });
  const data = await r.json();
  assert.equal(r.status, 200);
  assert.equal(data.demo, true);
  assert.equal(data.order.shipping, 490);
});

test('produit inconnu refusé avec un message lisible', async () => {
  const r = await post({ acceptTerms: true, items: [{ id: 'xx', qty: 1 }] });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /indisponible/);
});

test('pages légales servies, infos manquantes signalées', async () => {
  for (const page of ['mentions-legales', 'cgv', 'livraison-retours', 'confidentialite']) {
    const r = await fetch(`${base}/legal/${page}`);
    assert.equal(r.status, 200, page);
  }
  const html = await (await fetch(`${base}/legal/mentions-legales`)).text();
  assert.match(html, /À compléter : numéro SIRET/);
});

test('page inconnue → 404', async () => {
  const r = await fetch(`${base}/nexiste-pas`);
  assert.equal(r.status, 404);
});
