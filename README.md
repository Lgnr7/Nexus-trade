# Nexus Trade v5

Hub de trading crypto : bot Kraken multi-paires, sniper Solana, risk manager
global, backtests et alertes — le tout dans un seul service Node.js déployable
sur Render en free tier.

```
Node.js 20+ · Express · WebSocket (ws) · front vanilla sans build
```

---

## Ce que fait l'application

### 1. Bot Kraken

* Surveille **16 paires** en continu : BTC, ETH, SOL, XRP, ADA, DOT, LINK,
  AVAX, LTC, BCH, ATOM, NEAR, UNI, ETC, XLM, DOGE.
* Calcule **RSI(14) de Wilder, MACD(12/26/9), bandes de Bollinger(20, 2),
  tendance EMA(9/21) et volume relatif**, puis agrège le tout en une
  **confiance 0-100** — chaque décision est affichée avec ses raisons.
* **Scanner multi-paires** : à chaque cycle, seule la meilleure opportunité
  au-dessus du seuil est retenue, pas la première venue.
* **Trailing stop réel** (le stop ne redescend jamais) et **stops adaptatifs
  ATR** : un stop plus serré que la volatilité normale de la paire se fait
  sortir par le bruit, donc la distance prend le maximum entre le réglage et
  l'ATR.
* **Seuil de confirmation adaptatif** : le bot exige un score plus élevé quand
  le win rate des 20 derniers trades baisse, et se détend quand il remonte.
* **P&L réel** calculé à chaque vente, frais taker Kraken (0,26 %) déduits à
  l'achat comme à la vente, y compris en démo.
* **Mode DÉMO** (10 000 $ virtuels) et **mode LIVE** (ordres réels).
* **Positions persistées côté serveur** : elles survivent aux redémarrages et
  aux redéploiements.
* Reconnexion API au démarrage et bouton de reconnexion manuelle.

### 2. Sniper Solana

* Polling **DexScreener** (profils récents + tokens boostés) pour détecter les
  nouveaux tokens.
* **Score 0-100** sur 8 critères pondérés : liquidité (20), volume 1 h (16),
  momentum 5 min (14), ratio achats/ventes (14), âge (12), market cap (10),
  activité transactions (8), présence sociale (6). Le détail est affiché
  critère par critère.
* **Détection anti-manipulation** : liquidité insuffisante, ratio
  volume/liquidité aberrant (wash trading), ventes massives en cours, token de
  moins de 2 minutes, adresse blacklistée. Les bloqueurs interdisent l'achat
  automatique ; les avertissements sont affichés sans bloquer.
* **Smart money tracker on-chain réel** : lecture des dernières transactions
  des wallets suivis via RPC, extraction des tokens dont leur solde a augmenté,
  et **bonus de score** pour les tokens qu'ils achètent.
* **Détection du déployeur** (optionnelle) : remontée jusqu'à la transaction de
  création du mint pour identifier le dev, vérification de la blacklist et de
  son historique d'activité.
* **Achat via Jupiter** (meilleure route automatique entre tous les DEX Solana),
  vente manuelle ou automatique (TP / SL / trailing) avec P&L.
* **Mode démo** : sans clé privée, le sniper scanne, score et simule — il ne
  reste pas inutilisable en attendant la configuration du wallet.

### 3. Risk manager

Des limites globales qui s'appliquent **aux deux bots** :

| Limite | Effet |
|---|---|
| Perte max journalière | coupe tout le trading quand elle est atteinte |
| Max par trade Kraken | réduit automatiquement la mise |
| Max par memecoin | réduit automatiquement la mise |
| Positions ouvertes max | refuse toute nouvelle entrée |
| Trades Kraken par jour | refuse toute nouvelle entrée Kraken |

Les **sorties ne sont jamais bloquées** : on doit toujours pouvoir couper. Les
compteurs journaliers repartent à zéro au changement de jour UTC. Un bouton
**arrêt d'urgence** stoppe les deux bots, ferme toutes les positions et coupe
le trading jusqu'à réautorisation manuelle.

**Mode apprentissage** : l'historique est découpé par tranche de score (0-10,
10-20 … 90-100) avec win rate, P&L moyen et P&L total par tranche, puis le
système recommande le **score minimum optimal** — le plus bas palier à partir
duquel toutes les tranches supérieures mesurées sont rentables. Les tranches
sous 5 trades sont marquées comme non fiables au lieu d'être présentées comme
des résultats.

### 4. Portefeuille global

Vue combinée Kraken + Solana : soldes réels lus sur Kraken et on-chain en mode
LIVE, soldes virtuels en démo, valorisation en dollars de chaque actif,
positions ouvertes et P&L de session (ouvert + réalisé).

### 5. Backtests

Rejoue **exactement la stratégie du bot** (même module de signaux) sur
l'historique réel Kraken, bougie par bougie, avec :

* frais taker déduits des deux côtés,
* hypothèse pessimiste quand une bougie touche à la fois le stop et le TP
  (comptée comme une perte),
* trailing stop avancé par le plus haut de la bougie avant test du plus bas,
* win rate, profit factor, drawdown maximum, courbe d'équité,
* et la **recommandation de seuil** calculée sur les trades simulés.

Disponible depuis l'interface ou en ligne de commande :

```bash
npm run backtest -- --interval 15 --min-confirmation 70 --pairs BTC,ETH,SOL
```

> Kraken limite son historique public à environ 720 bougies par paire : en
> 15 minutes cela couvre une semaine, en 4 heures environ quatre mois.

### 6. Alertes Telegram et Discord

Entrées, sorties avec P&L, coupures du risk manager et ordres refusés sont
poussés vers Telegram et/ou Discord. Les deux canaux sont indépendants et
optionnels, avec un bouton de test dans l'interface.

---

## Installation locale

```bash
git clone https://github.com/Lgnr7/Nexus-trade.git
cd Nexus-trade
npm install
cp .env.example .env     # puis renseigne ce dont tu as besoin
npm start                # http://localhost:3000
```

Sans aucune variable d'environnement, l'application démarre et fonctionne en
mode démo sur les données publiques.

```bash
npm run dev      # rechargement automatique
npm test         # 37 tests unitaires (indicateurs, signaux, risque, scoring)
```

---

## Déploiement sur Render

Le fichier `render.yaml` décrit le service complet (build, start, health check,
disque persistant). Sinon, manuellement :

| Réglage | Valeur |
|---|---|
| Environment | Node |
| Build command | `npm ci --omit=dev` |
| Start command | `npm start` |

`npm start` lance `server/index.js`. Un `server.js` à la racine existe
uniquement pour que `node server.js` fonctionne aussi : c'est la commande de
démarrage par défaut de beaucoup d'hébergeurs. La version de Node est fixée par
`.nvmrc` et bornée dans `engines` — sans borne haute, Render installe la
dernière version publiée, y compris une que personne n'a testée.
| Health check path | `/api/health` |

**Persistance** — Render ne propose de disque persistant qu'à partir des plans
payants. En free tier, le système de fichiers est éphémère : les positions,
l'historique et les réglages repartent à zéro à chaque redéploiement et à
chaque réveil après mise en veille. Sur un plan payant, ajoute un disque monté
sur `/var/data` et `DATA_DIR=/var/data/nexus` (le bloc est prêt, commenté, dans
`render.yaml`).

Sans clés API, l'application fonctionne immédiatement : les endpoints publics
Kraken (prix, bougies) n'en demandent pas, donc le mode démo tourne sur de
vraies données de marché sans aucune configuration.

### Variables d'environnement

| Variable | Obligatoire | Rôle |
|---|---|---|
| `KRAKEN_KEY` / `KRAKEN_SECRET` | pour le LIVE | clés API Kraken (permissions : consulter les soldes + passer des ordres) |
| `ALLOW_LIVE_TRADING` | pour le LIVE | **verrou serveur** : tant que ce n'est pas `true`, aucun ordre réel ne part, quoi que demande l'interface |
| `SOLANA_PRIVATE_KEY` | pour sniper en réel | clé privée du wallet Phantom, format bs58 (~88 caractères) |
| `SOLANA_RPC` | non | RPC custom (Helius, QuickNode…). Le RPC public par défaut est limité à quelques requêtes/seconde : trop lent pour sniper sérieusement |
| `SMART_WALLETS` | non | adresses à suivre, séparées par des virgules |
| `DEV_BLACKLIST` | non | adresses de déployeurs à bannir |
| `DASHBOARD_PASSWORD` | recommandé | protège l'interface et le flux WebSocket |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | non | alertes Telegram |
| `DISCORD_WEBHOOK_URL` | non | alertes Discord |
| `DATA_DIR` | non | répertoire de persistance (défaut `./data`) |
| `PORT` | non | fourni par Render |

---

## Sécurité

* **Le mode LIVE a deux verrous** : le réglage dans l'interface *et*
  `ALLOW_LIVE_TRADING=true` côté serveur. L'interface seule ne peut pas
  déclencher d'ordre réel.
* **Le dashboard n'est pas public par défaut si `DASHBOARD_PASSWORD` est
  défini** : l'API REST et le WebSocket sont protégés par le même contrôle, et
  le cookie stocke un HMAC, pas le mot de passe.
* **Les logs sont caviardés** : toute chaîne ressemblant à une clé est masquée
  avant d'atteindre stdout — les logs Render sont lisibles par tous ceux qui
  ont accès au dashboard.
* **Les secrets ne quittent jamais le serveur** : aucune clé n'est envoyée au
  navigateur. `.env` et `data/` sont ignorés par git.
* Ne mets jamais une clé privée Solana contenant plus que ce que tu acceptes de
  perdre : un sniper de memecoins peut tout perdre en quelques minutes.

---

## Architecture

```
server.js               alias de compatibilité vers server/index.js
server/
  index.js              serveur HTTP + WebSocket + arrêt propre
  config.js             variables d'environnement, verrou LIVE
  logger.js             logs horodatés, secrets caviardés
  store.js              persistance JSON atomique (tmp + rename)
  bus.js                bus d'événements (bots → WebSocket, alertes)
  portfolio.js          vue combinée Kraken + Solana
  exchanges/kraken.js   API Kraken publique et privée (signature HMAC-SHA512)
  indicators/           RSI, MACD, Bollinger, ATR, tendance, volume
  indicators/signals.js agrégation pondérée → confiance 0-100
  bots/krakenBot.js     scanner, entrées, trailing stop, P&L
  bots/solanaSniper.js  détection, scoring, achat/vente Jupiter
  solana/               wallet, Jupiter, DexScreener, smart money
  risk/                 limites globales + analyse par tranche de score
  backtest/             moteur de replay + CLI
  alerts/notifier.js    Telegram et Discord
  api/                  routes REST + authentification
public/                 interface (HTML/CSS/JS vanilla, sans build)
test/                   tests unitaires (node:test)
```

### Choix techniques

* **Pas d'étape de build côté front.** Le dossier `public/` est servi tel quel :
  déploiement instantané, aucune chaîne d'outils à maintenir.
* **Modules ES partout**, y compris dans le navigateur.
* **Écritures atomiques** (`tmp` + `rename`) et regroupées : un redémarrage en
  plein write ne laisse jamais un fichier tronqué.
* **Un bus d'événements** au lieu de laisser les bots connaître les clients
  connectés.
* **Le même module de signaux** sert au bot en production et au backtest : ce
  qui est mesuré est exactement ce qui est exécuté.
* **Dégradation gracieuse** : une API injoignable au démarrage n'empêche pas le
  serveur de répondre, sinon le health check Render ferait redémarrer le
  service en boucle.

---

## Interface

Un seul dashboard, six onglets : bot Kraken, sniper Solana, risk &
apprentissage, portefeuille, backtest, journal. Tout est mis à jour en temps
réel par WebSocket avec reconnexion automatique à délai croissant.

L'interface est **responsive** : au-dessous de 720 px, les tableaux deviennent
des cartes empilées, les graphiques adaptent leur échelle à la largeur réelle
et la barre d'actions passe en bas de l'écran.

Les couleurs de graphiques suivent une palette validée pour la vision des
couleurs sur fond sombre (échelle divergente bleu ↔ rouge, midpoint neutre), et
**le signe est toujours écrit** à côté d'un P&L : la couleur ne porte jamais
seule l'information.

---

## Limites connues

* L'historique de backtest est plafonné par l'API publique Kraken (~720 bougies
  par paire).
* Le smart money tracker et la détection de déployeur consomment beaucoup de
  requêtes RPC : sur le RPC public ils tournent au ralenti. Un endpoint Helius
  ou QuickNode change tout.
* Sur le free tier Render, l'instance s'endort après une période d'inactivité :
  les bots ne tournent pas pendant ce temps, et l'état non persisté est perdu au
  réveil. Un plan payant (avec disque) est nécessaire pour un fonctionnement
  24/7 fiable.
* Le backtest ne modélise ni le slippage ni la profondeur du carnet : les
  résultats sont optimistes par rapport au réel.

---

## Avertissement

Ce logiciel exécute des ordres avec de l'argent réel quand le mode LIVE est
activé. Le trading de crypto-actifs, en particulier de memecoins, peut entraîner
la perte totale des fonds engagés. Utilise-le en connaissance de cause, commence
en mode démo, et ne risque que ce que tu peux te permettre de perdre.
