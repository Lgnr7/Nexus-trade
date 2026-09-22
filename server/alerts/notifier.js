import { config } from '../config.js';
import { bus } from '../bus.js';
import { createLogger } from '../logger.js';
import { fetchJson } from '../util/retry.js';
import { fmtPrice } from '../util/num.js';

const log = createLogger('alertes');

/**
 * Relaie les événements importants vers Telegram et/ou Discord.
 * Les deux canaux sont optionnels et indépendants : configurer l'un
 * n'oblige pas à configurer l'autre.
 */
class Notifier {
  #queue = Promise.resolve();

  get channels() {
    return {
      telegram: Boolean(config.alerts.telegramToken && config.alerts.telegramChatId),
      discord: Boolean(config.alerts.discordWebhook),
    };
  }

  init() {
    const { telegram, discord } = this.channels;
    if (!telegram && !discord) {
      log.info('aucun canal d\'alerte configuré');
      return this;
    }
    log.info(`canaux actifs: ${[telegram && 'Telegram', discord && 'Discord'].filter(Boolean).join(', ')}`);
    bus.on('event', (event) => {
      const message = format(event);
      if (message) this.send(message);
    });
    return this;
  }

  /** Les envois sont sérialisés pour ne pas déclencher les rate limits. */
  send(text) {
    this.#queue = this.#queue.then(() => this.#deliver(text)).catch((err) => {
      log.warn('envoi échoué:', err.message);
    });
    return this.#queue;
  }

  async #deliver(text) {
    const jobs = [];
    if (this.channels.telegram) {
      jobs.push(
        fetchJson(`https://api.telegram.org/bot${config.alerts.telegramToken}/sendMessage`, {
          method: 'POST',
          timeout: 10_000,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: config.alerts.telegramChatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        }),
      );
    }
    if (this.channels.discord) {
      jobs.push(
        fetchJson(config.alerts.discordWebhook, {
          method: 'POST',
          timeout: 10_000,
          headers: { 'Content-Type': 'application/json' },
          // Discord n'accepte pas le HTML : on retire les balises.
          body: JSON.stringify({ content: text.replace(/<\/?[^>]+>/g, '') }),
        }),
      );
    }
    const results = await Promise.allSettled(jobs);
    for (const r of results) {
      if (r.status === 'rejected') log.warn('canal en erreur:', r.reason?.message);
    }
  }

  /** Test manuel depuis l'interface. */
  async test() {
    const { telegram, discord } = this.channels;
    if (!telegram && !discord) {
      throw Object.assign(new Error('Aucun canal configuré'), { status: 400 });
    }
    await this.#deliver('🟢 <b>Nexus Trade</b> — test d\'alerte réussi.');
    return this.channels;
  }
}

const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);

function format({ type, payload }) {
  switch (type) {
    case 'kraken:entry':
      return (
        `🟦 <b>ACHAT ${payload.symbol}</b> (${payload.mode.toUpperCase()})\n` +
        `Prix ${fmtPrice(payload.entryPrice)} $ · Mise ${payload.size} $ · Score ${payload.score}\n` +
        `TP ${fmtPrice(payload.takeProfit)} · SL ${fmtPrice(payload.stopLoss)}`
      );
    case 'kraken:exit':
      return (
        `${payload.pnl >= 0 ? '🟩' : '🟥'} <b>VENTE ${payload.symbol}</b> — ${sign(payload.pnl)} $ ` +
        `(${sign(payload.pnlPct)} %)\nMotif : ${payload.reason}`
      );
    case 'sniper:entry':
      return (
        `🎯 <b>SNIPE ${payload.symbol}</b> (${payload.mode.toUpperCase()})\n` +
        `Score ${payload.score} · Mise ${payload.size} $ · ${payload.url ?? ''}`
      );
    case 'sniper:exit':
      return (
        `${payload.pnl >= 0 ? '🟩' : '🟥'} <b>SORTIE ${payload.symbol}</b> — ${sign(payload.pnl)} $ ` +
        `(${sign(payload.pnlPct)} %)\nMotif : ${payload.reason}`
      );
    case 'risk:halt':
      return `⛔️ <b>TRADING COUPÉ</b> — ${payload.reason}\nP&L du jour : ${payload.realizedPnl} $`;
    case 'kraken:order-failed':
    case 'sniper:sell-failed':
      return `⚠️ <b>Ordre refusé</b> ${payload.symbol} — ${payload.error}`;
    case 'kraken:mode':
      return `⚙️ Mode Kraken → <b>${payload.mode.toUpperCase()}</b>`;
    default:
      return null;
  }
}

export const notifier = new Notifier();
