// Liste de contrôle avant d'ouvrir la boutique au public.
// Code de sortie 1 tant qu'un point bloquant reste ouvert.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, stripeEnabled, stripeLive } from '../config.js';
import { loadCatalog } from '../catalog.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const euro = (c) => (c / 100).toFixed(2).replace('.', ',') + ' €';
const blocking = [];
const warnings = [];

const shopFields = { owner: 'SHOP_OWNER (nom et prénom)', address: 'SHOP_ADDRESS (adresse)', siret: 'SHOP_SIRET', email: 'SHOP_EMAIL', mediator: 'SHOP_MEDIATOR (médiateur de la consommation)' };
for (const [k, label] of Object.entries(shopFields)) if (!config.shop[k]) blocking.push(`Information légale manquante : ${label}`);

if (!stripeEnabled()) blocking.push('STRIPE_SECRET_KEY absente : la boutique est en démonstration.');
else if (!stripeLive()) warnings.push('Clé Stripe de TEST : aucun paiement réel ne sera encaissé.');
if (stripeEnabled() && !config.stripeWebhookSecret) warnings.push('STRIPE_WEBHOOK_SECRET absent : les commandes payées ne seront pas journalisées côté serveur.');
if (config.publicUrl.includes('localhost')) blocking.push('PUBLIC_URL pointe vers localhost.');

const products = loadCatalog().filter((p) => p.active);
console.log(`\nCatalogue : ${products.length} produits actifs\n`);
console.log('Produit'.padEnd(30), 'Prix'.padStart(10), 'Coût'.padStart(10), 'Marge'.padStart(9), '  Fournisseur');
for (const p of products) {
  const s = p.supplier ?? {};
  const cost = s.costEstimate ?? 0;
  const margin = p.price - cost;
  const pct = Math.round((margin / p.price) * 100);
  const status = !s.url ? 'lien manquant' : s.costVerified ? 'vérifié' : 'coût à confirmer';
  console.log(p.name.slice(0, 29).padEnd(30), euro(p.price).padStart(10), euro(cost).padStart(10), `${pct} %`.padStart(9), ' ', status);
  if (!s.url) blocking.push(`${p.name} : aucun lien fournisseur (supplier.url).`);
  else if (!s.costVerified) warnings.push(`${p.name} : coût d'achat non confirmé (supplier.costVerified).`);
  if (pct < 40) warnings.push(`${p.name} : marge faible (${pct} %) une fois les frais Stripe et les retours déduits.`);
  if (!p.image) warnings.push(`${p.name} : pas de photo (l'illustration est affichée).`);
  else if (!fs.existsSync(path.join(root, 'public', p.image))) blocking.push(`${p.name} : image introuvable (${p.image}).`);
}

console.log('');
for (const w of warnings) console.log('  ⚠︎ ', w);
for (const b of blocking) console.log('  ✗ ', b);
console.log(blocking.length ? `\n${blocking.length} point(s) bloquant(s) avant l'ouverture.\n` : '\nPrêt à ouvrir.\n');
process.exit(blocking.length ? 1 : 0);
