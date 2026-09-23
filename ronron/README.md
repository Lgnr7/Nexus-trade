# Ronron : boutique d'accessoires pour chats

Boutique en ligne en dropshipping : le client paie sur le site (Stripe), tu
passes la commande chez le fournisseur, qui expédie directement chez lui.

```
Node.js 20+ · Express · Stripe Checkout · front sans build
```

## Lancer en local

```bash
cd ronron
cp .env.example .env
npm install
npm start            # http://localhost:3100
npm test             # tests du panier, des prix et de l'API
npm run check        # liste de ce qui manque avant d'ouvrir
```

Sans clé Stripe, la boutique tourne en **démonstration** : on peut tout
parcourir et « commander », mais rien n'est encaissé. Un bandeau jaune le
signale en haut de page.

## Comment ça marche

| Fichier | Rôle |
| --- | --- |
| `data/products.json` | Le catalogue : prix de vente, textes, coloris, et le fournisseur (lien, coût d'achat), que le navigateur ne voit jamais. |
| `server.js` | API : catalogue public, création du paiement Stripe, récapitulatif de commande, webhook. |
| `catalog.js` | Recalcule chaque panier à partir du catalogue : le prix payé vient toujours du serveur, jamais du navigateur. |
| `legal.js` | Mentions légales, CGV, livraison et retours, confidentialité, remplies avec tes infos. |
| `public/` | Le site (page d'accueil, page de remerciement, photos). |
| `scripts/check.js` | Liste de contrôle avant ouverture : infos légales, Stripe, liens fournisseurs, marges. |

Tous les prix sont en **centimes** (`3990` = 39,90 €).

## Ouvrir la boutique pour de vrai

### 1. Statut

Créer une micro-entreprise (gratuit, sur formalites.entreprises.gouv.fr)
pour obtenir un SIRET. Par défaut, le site affiche « TVA non applicable,
art. 293 B du CGI » (franchise de TVA). Adhérer aussi à un **médiateur de la
consommation** : c'est obligatoire pour vendre à des particuliers.

### 2. Fournisseur et produits

1. Créer un compte sur CJ Dropshipping (ou BigBuy, Spocket…).
2. Pour chaque produit de `data/products.json`, chercher le champ
   `supplier.search`, choisir une offre (privilégier les **entrepôts en
   Europe** : livraison plus rapide, pas de droits de douane), commander un
   échantillon pour vérifier la qualité.
3. Renseigner `supplier.url`, `supplier.sku`, `supplier.costEstimate` (coût
   réel livraison comprise, en centimes) et passer `costVerified` à `true`.
4. Aligner la fiche (`spec`, `facts`, `desc`) sur la fiche du fournisseur.
   N'affiche que ce qui est vrai pour le produit reçu.
5. Ajouter les photos dans `public/images/` et renseigner `image`. Utilise
   uniquement des photos que tu as le droit d'exploiter.
6. Retirer un produit : `"active": false`.

Les coûts actuels sont des **estimations** : `npm run check` affiche la
marge de chaque produit et signale ceux qui ne sont pas encore vérifiés.

### 3. Stripe

1. Créer un compte sur stripe.com et renseigner l'entreprise (SIRET, IBAN).
2. Commencer avec la clé **test** (`sk_test_…`) : payer avec la carte
   `4242 4242 4242 4242`, n'importe quelle date future et n'importe quel
   CVC.
3. Développeurs → Webhooks → ajouter
   `https://<ton-site>/api/stripe/webhook`, événement
   `checkout.session.completed`, puis copier le secret dans
   `STRIPE_WEBHOOK_SECRET`.
4. Paramètres → E-mails clients : activer les reçus de paiement.
5. Quand tout est prêt, remplacer par la clé **live** (`sk_live_…`).

### 4. Mise en ligne sur Render

Le `render.yaml` à la racine du dépôt déclare le service `ronron`. Dans
Render : New → Blueprint → ce dépôt, puis renseigner les variables marquées
`sync: false` (`PUBLIC_URL`, clés Stripe, infos légales). Pour un nom de
domaine (ex. `ronron.fr`) : Settings → Custom Domains.

En free tier, le service s'endort après 15 minutes sans visite : le premier
chargement prend alors environ 30 secondes. Pour une vraie boutique, passer
au plan Starter.

### 5. Traiter une commande

1. Stripe t'envoie une notification de paiement ; le détail (adresse,
   téléphone, articles) est dans Stripe → Paiements. Le journal Render
   affiche aussi une ligne `COMMANDE PAYÉE … panier=source/Blancx1, …`.
2. Passer la commande chez le fournisseur avec l'adresse du client.
3. Envoyer le numéro de suivi au client par e-mail.

## Avant d'ouvrir : ce qu'il ne faut pas afficher

Le droit français interdit les pratiques commerciales trompeuses : faux
avis, faux prix barrés, fausses mentions « best-seller », délais ou
garanties que tu ne tiens pas. Le site n'affiche donc ni avis ni prix barré.
Ajoute-les seulement quand ils sont réels : des avis de vrais clients, et un
prix barré qui correspond au plus bas prix pratiqué dans les 30 jours
précédents.

Les pages légales sont des modèles de travail, pas un conseil juridique :
relis-les (ou fais-les relire) avant l'ouverture.
