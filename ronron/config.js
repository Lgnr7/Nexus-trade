import 'dotenv/config';

const int = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));

// Tous les montants sont en centimes d'euro, comme chez Stripe : pas de
// flottants dans les calculs de prix.
export const config = {
  port: int(process.env.PORT, 3100),
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3100').replace(/\/$/, ''),

  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',

  shipping: {
    freeFrom: int(process.env.FREE_SHIPPING_FROM, 4900),
    cost: int(process.env.SHIPPING_COST, 490),
    // Délais réalistes en dropshipping : préparation chez le fournisseur +
    // transport. À ajuster selon l'entrepôt réellement utilisé.
    minDays: int(process.env.DELIVERY_MIN_DAYS, 6),
    maxDays: int(process.env.DELIVERY_MAX_DAYS, 12),
    countries: (process.env.SHIP_COUNTRIES || 'FR,BE,LU,MC').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean),
  },

  // Informations légales affichées dans les mentions légales, les CGV et le
  // pied de page. Tant qu'elles manquent, `npm run check` refuse la mise en
  // ligne.
  shop: {
    name: process.env.SHOP_NAME || 'Ronron',
    owner: process.env.SHOP_OWNER || '',
    address: process.env.SHOP_ADDRESS || '',
    siret: process.env.SHOP_SIRET || '',
    email: process.env.SHOP_EMAIL || '',
    // Micro-entreprise en franchise de TVA par défaut.
    vatNote: process.env.SHOP_VAT_NOTE || 'TVA non applicable, art. 293 B du CGI',
    host: process.env.SHOP_HOST || 'Render Services, Inc., San Francisco (Californie, États-Unis) — https://render.com',
    mediator: process.env.SHOP_MEDIATOR || '',
  },
};

export const stripeEnabled = () => config.stripeSecretKey.startsWith('sk_');
export const stripeLive = () => config.stripeSecretKey.startsWith('sk_live_');
