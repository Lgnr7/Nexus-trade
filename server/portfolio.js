import { kraken } from './exchanges/kraken.js';
import { krakenBot } from './bots/krakenBot.js';
import { sniper } from './bots/solanaSniper.js';
import { wallet } from './solana/wallet.js';
import { riskManager } from './risk/riskManager.js';
import { refreshToken } from './solana/dexscreener.js';
import { createLogger } from './logger.js';
import { round } from './util/num.js';

const log = createLogger('portefeuille');

// Les codes d'actifs Kraken historiques (XXBT, XETH…) ne parlent à personne.
const ASSET_LABELS = {
  XXBT: 'BTC', XBT: 'BTC', XETH: 'ETH', XXRP: 'XRP', XLTC: 'LTC',
  XXLM: 'XLM', XETC: 'ETC', XDG: 'DOGE', ZUSD: 'USD', ZEUR: 'EUR',
};
const label = (asset) => ASSET_LABELS[asset] ?? asset;

/** Paire USD correspondant à un actif Kraken, pour le valoriser en dollars. */
const usdPair = (asset) => {
  const sym = label(asset);
  if (sym === 'USD') return null;
  return sym === 'DOGE' ? 'XDGUSD' : `${sym}USD`;
};

/**
 * Vue combinée Kraken + Solana. En mode démo, les soldes virtuels des deux
 * bots sont affichés ; en mode live, les soldes réels sont lus sur Kraken et
 * sur la blockchain.
 */
export async function buildPortfolio() {
  const [krakenSide, solanaSide] = await Promise.all([krakenHoldings(), solanaHoldings()]);

  const krakenPositionsValue = round(
    krakenBot.snapshot().positions.reduce((a, p) => a + p.size + p.pnl, 0),
    2,
  );
  const sniperPositionsValue = round(
    sniper.snapshot().positions.reduce((a, p) => a + p.size + p.pnl, 0),
    2,
  );

  const totalValue = round(
    krakenSide.totalUsd + solanaSide.totalUsd + krakenPositionsValue + sniperPositionsValue,
    2,
  );

  const openPnl = round(krakenBot.snapshot().openPnl + sniper.snapshot().openPnl, 2);
  const realisedToday = riskManager.snapshot().realizedPnl;

  return {
    updatedAt: Date.now(),
    totalValue,
    openPnl,
    realisedToday,
    sessionPnl: round(openPnl + realisedToday, 2),
    kraken: {
      ...krakenSide,
      mode: krakenBot.mode,
      positionsValue: krakenPositionsValue,
      openPositions: krakenBot.snapshot().positions.length,
    },
    solana: {
      ...solanaSide,
      mode: sniper.snapshot().mode,
      positionsValue: sniperPositionsValue,
      openPositions: sniper.snapshot().positions.length,
    },
  };
}

async function krakenHoldings() {
  const snap = krakenBot.snapshot();
  if (snap.mode !== 'live' || !kraken.configured) {
    return {
      source: 'démo',
      totalUsd: snap.demoBalance,
      assets: [{ asset: 'USD (démo)', amount: snap.demoBalance, valueUsd: snap.demoBalance }],
    };
  }

  try {
    const balances = await kraken.balance();
    const entries = Object.entries(balances);
    const pairs = entries.map(([asset]) => usdPair(asset)).filter(Boolean);
    const tickers = pairs.length ? await kraken.tickers(pairs) : new Map();

    const assets = entries.map(([asset, amount]) => {
      const pair = usdPair(asset);
      const price = pair ? (tickers.get(pair)?.price ?? 0) : 1;
      return {
        asset: label(asset),
        amount: round(amount, 8),
        price: round(price, 6),
        valueUsd: round(amount * price, 2),
      };
    });

    return {
      source: 'live',
      totalUsd: round(assets.reduce((a, x) => a + x.valueUsd, 0), 2),
      assets: assets.filter((a) => a.valueUsd >= 0.01).sort((a, b) => b.valueUsd - a.valueUsd),
    };
  } catch (err) {
    log.warn('soldes Kraken indisponibles:', err.message);
    return { source: 'erreur', error: err.message, totalUsd: 0, assets: [] };
  }
}

async function solanaHoldings() {
  const snap = sniper.snapshot();
  if (!wallet.canTrade) {
    return {
      source: 'démo',
      connected: false,
      totalUsd: snap.demoBalance,
      assets: [{ asset: 'USD (démo)', amount: snap.demoBalance, valueUsd: snap.demoBalance }],
    };
  }

  try {
    const [sol, tokens] = await Promise.all([wallet.solBalance(), wallet.tokenAccounts()]);
    const solUsd = await sniper.solPrice();
    const assets = [
      { asset: 'SOL', amount: round(sol, 6), price: round(solUsd, 2), valueUsd: round(sol * solUsd, 2) },
    ];

    // Valorisation des tokens SPL détenus : on interroge DexScreener token
    // par token, en se limitant aux 15 premiers pour ne pas ralentir la vue.
    const priced = await Promise.allSettled(
      tokens.slice(0, 15).map(async (t) => {
        const info = await refreshToken(t.mint);
        return { ...t, info };
      }),
    );
    for (const entry of priced) {
      if (entry.status !== 'fulfilled' || !entry.value.info) continue;
      const { amount, info } = entry.value;
      assets.push({
        asset: info.symbol,
        mint: entry.value.mint,
        amount: round(amount, 6),
        price: info.priceUsd,
        valueUsd: round(amount * info.priceUsd, 2),
      });
    }

    return {
      source: 'live',
      connected: true,
      address: wallet.status.address,
      totalUsd: round(assets.reduce((a, x) => a + x.valueUsd, 0), 2),
      assets: assets.filter((a) => a.valueUsd >= 0.01).sort((a, b) => b.valueUsd - a.valueUsd),
    };
  } catch (err) {
    log.warn('soldes Solana indisponibles:', err.message);
    return { source: 'erreur', connected: true, error: err.message, totalUsd: 0, assets: [] };
  }
}
