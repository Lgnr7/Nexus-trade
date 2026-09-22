import 'dotenv/config';
import path from 'node:path';

const bool = (v, fallback = false) => {
  if (v === undefined || v === null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
};

const list = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  port: Number(process.env.PORT || 3000),
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  dashboardPassword: process.env.DASHBOARD_PASSWORD || '',

  kraken: {
    key: process.env.KRAKEN_KEY || '',
    secret: process.env.KRAKEN_SECRET || '',
  },

  // Verrou matériel du mode LIVE : sans cette variable d'environnement,
  // aucun ordre réel ne part, quoi que demande l'interface.
  allowLiveTrading: bool(process.env.ALLOW_LIVE_TRADING, false),

  solana: {
    privateKey: process.env.SOLANA_PRIVATE_KEY || '',
    rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
    smartWallets: list(process.env.SMART_WALLETS),
    devBlacklist: list(process.env.DEV_BLACKLIST),
  },

  alerts: {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
    discordWebhook: process.env.DISCORD_WEBHOOK_URL || '',
  },
};

export const hasKrakenKeys = () => Boolean(config.kraken.key && config.kraken.secret);
export const hasSolanaWallet = () => Boolean(config.solana.privateKey);
