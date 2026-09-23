import { config } from './config.js';

// Modèles de pages légales pour une micro-entreprise française qui vend en
// ligne à des particuliers. Ce sont des bases de travail, pas un conseil
// juridique : à relire avant l'ouverture.

export const LEGAL_PAGES = ['mentions-legales', 'cgv', 'livraison-retours', 'confidentialite'];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const euro = (cents) => (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

function field(key, label) {
  const v = config.shop[key];
  return v ? esc(v) : `<mark>[À compléter : ${label}]</mark>`;
}

const COUNTRY = { FR: 'France métropolitaine', BE: 'Belgique', LU: 'Luxembourg', MC: 'Monaco', CH: 'Suisse', DE: 'Allemagne', ES: 'Espagne', IT: 'Italie', NL: 'Pays-Bas' };

function pages() {
  const s = config.shop;
  const ship = config.shipping;
  const name = esc(s.name);
  const owner = field('owner', 'nom et prénom');
  const address = field('address', 'adresse postale');
  const siret = field('siret', 'numéro SIRET');
  const email = field('email', 'e-mail de contact');
  const countries = ship.countries.map((c) => COUNTRY[c] ?? c).join(', ');
  const mediator = field('mediator', 'nom et site du médiateur de la consommation');

  return {
    'mentions-legales': {
      title: 'Mentions légales',
      body: `
<h2>Éditeur du site</h2>
<p>Le site ${name} est édité par ${owner}, entrepreneur individuel (micro-entreprise).<br>
Adresse : ${address}<br>
SIRET : ${siret}<br>
Contact : ${email}<br>
${esc(s.vatNote)}</p>
<p>Directeur de la publication : ${owner}.</p>

<h2>Hébergement</h2>
<p>${esc(s.host)}</p>

<h2>Paiement</h2>
<p>Les paiements sont traités par Stripe Payments Europe, Ltd. (Irlande). ${name} n'a jamais accès à vos coordonnées bancaires.</p>

<h2>Propriété intellectuelle</h2>
<p>Les textes, illustrations et le logo de ${name} sont protégés. Toute reproduction sans autorisation écrite est interdite.</p>`,
    },

    cgv: {
      title: 'Conditions générales de vente',
      body: `
<p class="muted">En vigueur à compter du ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>

<h2>1. Vendeur</h2>
<p>${owner}, entrepreneur individuel — ${address} — SIRET ${siret} — ${email}.</p>

<h2>2. Champ d'application</h2>
<p>Les présentes conditions s'appliquent à toute commande passée sur ${name} par un consommateur. Passer commande implique leur acceptation, matérialisée par la case à cocher avant le paiement.</p>

<h2>3. Produits</h2>
<p>Les caractéristiques essentielles de chaque produit sont présentées sur sa fiche. Les illustrations sont indicatives. Les produits sont proposés dans la limite des stocks de nos fournisseurs ; en cas d'indisponibilité après commande, vous êtes informé et intégralement remboursé sous 14 jours.</p>

<h2>4. Prix</h2>
<p>Les prix sont indiqués en euros, toutes taxes comprises. ${esc(s.vatNote)}. Les frais de livraison (${euro(ship.cost)}, offerts dès ${euro(ship.freeFrom)} d'achat) sont indiqués avant le paiement.</p>

<h2>5. Commande et paiement</h2>
<p>Le paiement est exigible à la commande, par carte bancaire, Apple Pay ou Google Pay, via la plateforme sécurisée Stripe. La commande est ferme dès la confirmation du paiement ; un e-mail de confirmation vous est envoyé.</p>

<h2>6. Livraison</h2>
<p>Livraison en ${esc(countries)}. Les produits sont expédiés par nos partenaires logistiques ; le délai indicatif est de ${ship.minDays} à ${ship.maxDays} jours ouvrés après la commande. Un numéro de suivi vous est communiqué par e-mail. En cas de retard de plus de 30 jours, vous pouvez annuler la commande et être remboursé (art. L216-2 du Code de la consommation).</p>

<h2>7. Droit de rétractation</h2>
<p>Vous disposez de 14 jours à compter de la réception du produit pour vous rétracter, sans avoir à vous justifier (art. L221-18 du Code de la consommation). Informez-nous par e-mail à ${email} ou au moyen du formulaire ci-dessous, puis renvoyez le produit dans les 14 jours suivants, complet et dans son état d'origine. Les frais de retour sont à votre charge. Nous vous remboursons la totalité des sommes versées, frais de livraison initiaux inclus (sur la base du tarif standard), dans les 14 jours suivant votre demande ; le remboursement peut être différé jusqu'à réception du produit ou d'une preuve d'expédition.</p>
<div class="box"><b>Formulaire de rétractation</b><br>
À l'attention de ${owner}, ${address}, ${email} :<br>
Je vous notifie par la présente ma rétractation du contrat portant sur la vente du bien ci-dessous :<br>
Commandé le / reçu le : …… · Nom : …… · Adresse : …… · Date : …… · Signature (si papier) : ……</div>

<h2>8. Garanties légales</h2>
<p>Tous les produits bénéficient de la garantie légale de conformité (art. L217-3 et suivants du Code de la consommation) pendant 2 ans à compter de la livraison, et de la garantie des vices cachés (art. 1641 et suivants du Code civil). En cas de défaut, contactez-nous à ${email} : nous proposons la réparation ou le remplacement, ou à défaut le remboursement.</p>

<h2>9. Données personnelles</h2>
<p>Voir notre <a href="/legal/confidentialite">politique de confidentialité</a>.</p>

<h2>10. Médiation et litiges</h2>
<p>En cas de litige, contactez-nous d'abord à ${email}. À défaut de solution amiable, vous pouvez recourir gratuitement au médiateur de la consommation : ${mediator}. Les présentes conditions sont soumises au droit français.</p>`,
    },

    'livraison-retours': {
      title: 'Livraison et retours',
      body: `
<h2>Livraison</h2>
<ul>
<li>Pays livrés : ${esc(countries)}.</li>
<li>Frais : ${euro(ship.cost)}, <b>offerts dès ${euro(ship.freeFrom)}</b> d'achat.</li>
<li>Délai indicatif : ${ship.minDays} à ${ship.maxDays} jours ouvrés, avec numéro de suivi envoyé par e-mail.</li>
<li>Les produits sont expédiés directement depuis les entrepôts de nos partenaires. Une commande de plusieurs articles peut arriver en plusieurs colis.</li>
</ul>

<h2>Retours</h2>
<ul>
<li>14 jours après réception pour changer d'avis, sans justification.</li>
<li>Écrivez-nous d'abord à ${email} : nous vous indiquons l'adresse de retour.</li>
<li>Remboursement sous 14 jours, sur le moyen de paiement utilisé.</li>
</ul>

<h2>Produit abîmé ou défectueux</h2>
<p>Envoyez-nous une photo à ${email} dans les meilleurs délais : remplacement ou remboursement à nos frais, dans le cadre de la garantie légale de conformité de 2 ans.</p>`,
    },

    confidentialite: {
      title: 'Politique de confidentialité',
      body: `
<h2>Responsable du traitement</h2>
<p>${owner} — ${address} — ${email}.</p>

<h2>Données collectées et finalités</h2>
<ul>
<li><b>Commande</b> : nom, adresse de livraison, e-mail, téléphone — pour préparer, expédier et suivre votre commande (exécution du contrat). Ces informations sont transmises au fournisseur et au transporteur uniquement pour la livraison.</li>
<li><b>Paiement</b> : traité directement par Stripe ; nous ne voyons ni ne stockons votre numéro de carte.</li>
<li><b>Newsletter</b> : votre e-mail, uniquement si vous vous inscrivez (consentement), désinscription possible à tout moment.</li>
</ul>

<h2>Durée de conservation</h2>
<p>Les pièces comptables (factures, commandes) sont conservées 10 ans (obligation légale). Les données de prospection sont conservées 3 ans après le dernier contact.</p>

<h2>Cookies et stockage local</h2>
<p>Le site n'utilise aucun cookie publicitaire ni outil de mesure d'audience. Votre panier et vos favoris sont conservés dans votre navigateur (stockage local) pour le bon fonctionnement du site ; ils ne nous sont pas transmis.</p>

<h2>Vos droits</h2>
<p>Vous pouvez accéder à vos données, les rectifier, les effacer ou vous opposer à leur traitement en écrivant à ${email}. Vous pouvez aussi saisir la CNIL (cnil.fr).</p>`,
    },
  };
}

export function renderLegal(page) {
  const p = pages()[page];
  const s = config.shop;
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)} · ${esc(s.name)}</title>
<link rel="stylesheet" href="/legal.css">
</head><body>
<header><a class="logo" href="/">${esc(s.name.toLowerCase())}</a><a href="/">← Retour à la boutique</a></header>
<main><h1>${esc(p.title)}</h1>${p.body}</main>
<footer><a href="/legal/mentions-legales">Mentions légales</a> · <a href="/legal/cgv">CGV</a> · <a href="/legal/livraison-retours">Livraison et retours</a> · <a href="/legal/confidentialite">Confidentialité</a></footer>
</body></html>`;
}
