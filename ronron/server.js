import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import Stripe from 'stripe';

import { config, stripeEnabled, stripeLive } from './config.js';
import { loadCatalog, publicProduct, priceOrder } from './catalog.js';
import { renderLegal, LEGAL_PAGES } from './legal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const products = loadCatalog();
const stripe = stripeEnabled() ? new Stripe(config.stripeSecretKey) : null;
const log = (...a) => console.log(new Date().toISOString(), ...a);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
  });
  next();
});

// ── Webhook Stripe ──────────────────────────────────────────────────────────
// Déclaré avant express.json() : la vérification de signature a besoin du
// corps brut, octet pour octet.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe || !config.stripeWebhookSecret) return res.status(503).send('Webhook non configuré');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.stripeWebhookSecret);
  } catch (err) {
    log('webhook refusé :', err.message);
    return res.status(400).send('Signature invalide');
  }
  if (event.type === 'checkout.session.completed' && event.data.object.payment_status === 'paid') {
    const s = event.data.object;
    const addr = s.collected_information?.shipping_details?.address ?? s.shipping_details?.address ?? {};
    // Le journal Render garde une trace ; la source de vérité reste le
    // tableau de bord Stripe (Paiements → détail), qui contient l'adresse
    // complète à recopier chez le fournisseur.
    log(`COMMANDE PAYÉE ${s.id} · ${(s.amount_total / 100).toFixed(2)} € · ${s.customer_details?.email ?? '?'} · ${addr.postal_code ?? ''} ${addr.city ?? ''} ${addr.country ?? ''} · panier=${s.metadata?.cart ?? ''}`);
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/store', (req, res) => {
  res.json({
    shop: { name: config.shop.name, vatNote: config.shop.vatNote, email: config.shop.email },
    shipping: config.shipping,
    payments: stripe ? (stripeLive() ? 'live' : 'test') : 'demo',
    products: products.filter((p) => p.active).map(publicProduct),
  });
});

app.post('/api/checkout', async (req, res, next) => {
  try {
    if (req.body?.acceptTerms !== true) {
      return res.status(400).json({ error: 'Merci d\'accepter les conditions générales de vente pour continuer.' });
    }
    const order = priceOrder(req.body?.items, products, config.shipping);
    if (!stripe) {
      // Sans clé Stripe, la boutique tourne en démonstration : on valide le
      // panier mais aucun paiement n'est demandé.
      return res.json({ demo: true, order });
    }

    const byId = new Map(products.map((p) => [p.id, p]));
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      locale: 'fr',
      line_items: order.lines.map((l) => {
        const p = byId.get(l.id);
        return {
          quantity: l.qty,
          price_data: {
            currency: 'eur',
            unit_amount: l.unitPrice,
            product_data: {
              name: p.colors.length > 1 ? `${l.name} — ${l.colorLabel}` : l.name,
              ...(p.image ? { images: [`${config.publicUrl}${p.image}`] } : {}),
            },
          },
        };
      }),
      shipping_address_collection: { allowed_countries: config.shipping.countries },
      shipping_options: [{
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: order.shipping, currency: 'eur' },
          display_name: order.shipping ? 'Livraison standard suivie' : 'Livraison offerte',
          delivery_estimate: {
            minimum: { unit: 'business_day', value: config.shipping.minDays },
            maximum: { unit: 'business_day', value: config.shipping.maxDays },
          },
        },
      }],
      // Le transporteur en a besoin pour la livraison.
      phone_number_collection: { enabled: true },
      metadata: { cart: order.lines.map((l) => `${l.id}/${l.colorLabel}x${l.qty}`).join(', ').slice(0, 500) },
      success_url: `${config.publicUrl}/merci.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.publicUrl}/?panier=1`,
    });
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// Récapitulatif affiché sur la page de remerciement.
app.get('/api/order/:sessionId', async (req, res, next) => {
  try {
    if (!stripe) return res.status(404).json({ error: 'Paiements non activés.' });
    const id = req.params.sessionId;
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return res.status(400).json({ error: 'Identifiant de commande invalide.' });
    const s = await stripe.checkout.sessions.retrieve(id);
    res.json({
      paid: s.payment_status === 'paid',
      total: s.amount_total,
      email: s.customer_details?.email ?? null,
      reference: s.id.slice(-8).toUpperCase(),
    });
  } catch (err) {
    next(err);
  }
});

// ── Pages légales (remplies avec les infos de la boutique) ─────────────────
app.get('/legal/:page', (req, res, next) => {
  if (!LEGAL_PAGES.includes(req.params.page)) return next();
  res.type('html').send(renderLegal(req.params.page));
});

app.use(express.static(PUBLIC_DIR, { maxAge: '1h' }));

app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));

app.use((err, req, res, next) => {
  const status = err.status ?? (err.type?.startsWith('Stripe') ? 502 : 500);
  if (status >= 500) log('erreur', req.method, req.path, err.stack ?? err.message);
  res.status(status).json({
    error: status >= 500 ? 'Le paiement est momentanément indisponible. Réessayez dans un instant.' : err.message,
  });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(config.port, () => {
    const mode = stripe ? (stripeLive() ? 'PAIEMENTS RÉELS' : 'Stripe mode test') : 'démonstration (pas de clé Stripe)';
    log(`Ronron en ligne sur ${config.publicUrl} — ${mode}`);
    if (stripe && !config.stripeWebhookSecret) log('Attention : STRIPE_WEBHOOK_SECRET absent, les commandes payées ne seront pas journalisées.');
    if (!fs.existsSync(path.join(PUBLIC_DIR, 'images'))) log('Dossier public/images absent.');
  });
}

export { app };
