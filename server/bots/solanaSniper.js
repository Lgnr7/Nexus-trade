import {
  discoverSolanaTokens,
  fetchPairs,
  bestPairPerToken,
  normalise,
  refreshToken,
} from '../solana/dexscreener.js';
import { scoreToken, detectRisks } from '../solana/scoring.js';
import { smartMoney, inspectCreator } from '../solana/smartMoney.js';
import { wallet } from '../solana/wallet.js';
import * as jupiter from '../solana/jupiter.js';
import { kraken } from '../exchanges/kraken.js';
import { riskManager } from '../risk/riskManager.js';
import { Store } from '../store.js';
import { bus } from '../bus.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { round, pct, clamp } from '../util/num.js';
import { seconds } from '../util/time.js';

const log = createLogger('sniper');

export const DEFAULT_SNIPER_SETTINGS = {
  autoSnipe: false,
  minScore: 75,
  stakeUsd: 25,          // mise par token
  slippageBps: 300,      // 3 %
  takeProfitPct: 60,
  stopLossPct: 35,
  trailingStopPct: 25,
  useTrailingStop: true,
  maxPositions: 4,
  pollIntervalSec: 60,
  requireSocials: false,
  checkCreator: false,   // inspection on-chain du déployeur (coûteux en RPC)
  smartMoneyBonus: 10,   // points ajoutés par wallet smart money acheteur
};

const DEMO_START_USD = 1_000;

export class SolanaSniper {
  #timer = null;
  #busy = false;
  #solPrice = { value: 0, at: 0 };

  constructor() {
    this.store = new Store('sniper', {
      settings: { ...DEFAULT_SNIPER_SETTINGS },
      running: false,
      mode: 'demo',         // 'demo' | 'live' — live exige un wallet connecté
      demoBalance: DEMO_START_USD,
      positions: [],
      closed: [],
      lastPoll: null,
    });
    this.candidates = [];
    this.lastError = null;
  }

  init() {
    this.store.load();
    // Sans wallet, le mode live n'a aucun sens : on retombe en démo.
    if (this.store.data.mode === 'live' && !wallet.canTrade) {
      this.store.data.mode = 'demo';
      log.warn('mode live demandé mais wallet absent — retour en démo');
    }
    if (this.store.data.running) this.start();
    return this;
  }

  get settings() {
    return this.store.data.settings;
  }

  get isLive() {
    return this.store.data.mode === 'live' && wallet.canTrade && config.allowLiveTrading;
  }

  setSettings(patch) {
    const next = { ...this.settings };
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULT_SNIPER_SETTINGS)) continue;
      if (typeof DEFAULT_SNIPER_SETTINGS[key] === 'boolean') next[key] = Boolean(value);
      else {
        const num = Number(value);
        if (Number.isFinite(num) && num >= 0) next[key] = num;
      }
    }
    next.pollIntervalSec = clamp(next.pollIntervalSec, 20, 600);
    next.minScore = clamp(next.minScore, 0, 100);
    next.slippageBps = clamp(next.slippageBps, 10, 5_000);
    this.store.data.settings = next;
    this.store.save();
    if (this.store.data.running) this.#schedule();
    this.#broadcast();
    return next;
  }

  setMode(mode) {
    if (mode === 'live') {
      if (!wallet.canTrade) {
        throw Object.assign(new Error('Wallet Solana non connecté (SOLANA_PRIVATE_KEY absente)'), {
          status: 400,
        });
      }
      if (!config.allowLiveTrading) {
        throw Object.assign(new Error('Mode LIVE désactivé côté serveur (ALLOW_LIVE_TRADING=false)'), {
          status: 403,
        });
      }
      if (this.store.data.positions.length) {
        throw Object.assign(new Error('Ferme les positions démo avant de passer en LIVE'), {
          status: 409,
        });
      }
    }
    this.store.data.mode = mode === 'live' ? 'live' : 'demo';
    this.store.save();
    log.warn(`sniper → ${this.store.data.mode.toUpperCase()}`);
    this.#broadcast();
    return this.store.data.mode;
  }

  start() {
    this.store.data.running = true;
    this.store.save();
    this.#schedule();
    log.info(`sniper démarré (poll ${this.settings.pollIntervalSec}s, auto=${this.settings.autoSnipe})`);
    this.#broadcast();
    this.tick().catch((err) => log.error('poll initial:', err.message));
  }

  stop() {
    this.store.data.running = false;
    this.store.save();
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    log.info('sniper arrêté');
    this.#broadcast();
  }

  #schedule() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = setInterval(
      () => this.tick().catch((err) => log.error('poll:', err.message)),
      seconds(this.settings.pollIntervalSec),
    );
  }

  /** Prix SOL/USD via Kraken, mis en cache 60 s. */
  async solPrice() {
    if (Date.now() - this.#solPrice.at < 60_000 && this.#solPrice.value > 0) {
      return this.#solPrice.value;
    }
    try {
      const tickers = await kraken.tickers(['SOLUSD']);
      const price = tickers.get('SOLUSD')?.price ?? 0;
      if (price > 0) this.#solPrice = { value: price, at: Date.now() };
    } catch (err) {
      log.warn('prix SOL indisponible:', err.message);
    }
    return this.#solPrice.value;
  }

  async tick() {
    if (this.#busy) return;
    this.#busy = true;
    try {
      await this.#discover();
      await this.#managePositions();
      if (this.store.data.running && this.settings.autoSnipe) await this.#maybeSnipe();
      this.store.data.lastPoll = Date.now();
      this.store.save();
      this.lastError = null;
      this.#broadcast();
    } catch (err) {
      this.lastError = err.message;
      throw err;
    } finally {
      this.#busy = false;
    }
  }

  async #discover() {
    const addresses = await discoverSolanaTokens();
    if (!addresses.length) {
      log.warn('aucun token retourné par DexScreener');
      return;
    }
    const pairs = await fetchPairs(addresses);
    const tokens = bestPairPerToken(pairs).map(normalise);

    const scored = tokens
      .map((token) => {
        const { score, breakdown } = scoreToken(token);
        const risks = detectRisks(token, { devBlacklist: config.solana.devBlacklist });
        const smart = smartMoney.interestIn(token.address);
        // Le bonus smart money s'ajoute au score brut mais reste borné à 100.
        const bonus = Math.min(smart.count * this.settings.smartMoneyBonus, 25);
        return {
          ...token,
          score: Math.min(100, score + bonus),
          baseScore: score,
          smartMoneyBonus: bonus,
          smartMoney: smart,
          breakdown,
          risks,
        };
      })
      .sort((a, b) => b.score - a.score);

    this.candidates = scored.slice(0, 40);
  }

  async #maybeSnipe() {
    const positions = this.store.data.positions;
    if (positions.length >= this.settings.maxPositions) return;
    const held = new Set(positions.map((p) => p.address));

    for (const token of this.candidates) {
      if (held.has(token.address)) continue;
      if (token.score < this.settings.minScore) break; // liste triée : inutile d'aller plus loin
      if (!token.risks.safe) continue;
      if (this.settings.requireSocials && token.socials.socials + token.socials.websites === 0) {
        continue;
      }

      if (this.settings.checkCreator) {
        const creator = await inspectCreator(token.address);
        if (creator.blacklisted) {
          log.warn(`${token.symbol} ignoré — déployeur blacklisté`);
          continue;
        }
        // Un déployeur avec un historique énorme est presque toujours une
        // usine à tokens jetables.
        if (creator.deployCount !== null && creator.deployCount >= 190) {
          log.warn(`${token.symbol} ignoré — déployeur en série (${creator.deployCount} tx)`);
          continue;
        }
      }

      const verdict = riskManager.check({
        venue: 'solana',
        requestedSize: this.settings.stakeUsd,
        openPositions: positions.length,
      });
      if (!verdict.ok) {
        log.info(`snipe ${token.symbol} refusé — ${verdict.reason}`);
        return;
      }

      await this.buy(token.address, verdict.size, 'auto');
      return; // une entrée par cycle : on laisse le marché respirer
    }
  }

  /** Achat d'un token. `sizeUsd` en dollars. */
  async buy(address, sizeUsd, origin = 'manuel') {
    const token =
      this.candidates.find((c) => c.address === address) ??
      (await refreshToken(address).then((t) => (t ? { ...t, score: null, risks: detectRisks(t) } : null)));
    if (!token) throw Object.assign(new Error('Token introuvable sur DexScreener'), { status: 404 });
    if (this.store.data.positions.some((p) => p.address === address)) {
      throw Object.assign(new Error('Position déjà ouverte sur ce token'), { status: 409 });
    }
    if (token.priceUsd <= 0) throw Object.assign(new Error('Prix indisponible'), { status: 422 });

    let signature = null;
    let entryPrice = token.priceUsd;
    let rawAmount = null;
    let priceImpact = null;

    if (this.isLive) {
      const solUsd = await this.solPrice();
      if (!solUsd) throw new Error('Prix SOL indisponible, achat annulé');
      const solAmount = sizeUsd / solUsd;
      const balance = await wallet.solBalance();
      // On garde de quoi payer les frais et les comptes de token associés.
      if (balance < solAmount + 0.01) {
        throw Object.assign(
          new Error(`Solde SOL insuffisant (${balance.toFixed(4)} SOL disponibles)`),
          { status: 402 },
        );
      }
      const result = await jupiter.buyToken({
        mint: address,
        solAmount,
        slippageBps: this.settings.slippageBps,
      });
      signature = result.signature;
      rawAmount = result.outAmount;
      priceImpact = round(result.priceImpactPct, 3);
      log.info(`SNIPE LIVE ${token.symbol} — ${signature}`);
    } else {
      if (this.store.data.demoBalance < sizeUsd) {
        throw Object.assign(new Error('Solde démo insuffisant'), { status: 402 });
      }
      this.store.data.demoBalance = round(this.store.data.demoBalance - sizeUsd, 2);
    }

    const position = {
      id: `sol-${Date.now()}-${address.slice(0, 6)}`,
      venue: 'solana',
      address,
      symbol: token.symbol,
      name: token.name,
      dex: token.dex,
      url: token.url,
      mode: this.store.data.mode,
      origin,
      signature,
      rawAmount,
      priceImpact,
      openedAt: Date.now(),
      entryPrice,
      size: round(sizeUsd, 2),
      // Quantité valorisée en dollars. DexScreener ne renvoie pas les
      // décimales du mint, donc on suit la position en valeur plutôt qu'en
      // unités brutes ; `rawAmount` (la quantité réellement reçue) est
      // conservée à part et c'est elle qui sert à la revente on-chain.
      tokenAmount: sizeUsd / entryPrice,
      score: token.score,
      breakdown: token.breakdown ?? null,
      warnings: token.risks?.warnings ?? [],
      currentPrice: entryPrice,
      peakPrice: entryPrice,
      takeProfit: entryPrice * (1 + this.settings.takeProfitPct / 100),
      stopLoss: entryPrice * (1 - this.settings.stopLossPct / 100),
      trailingPct: this.settings.useTrailingStop ? this.settings.trailingStopPct : null,
      trailingStop: this.settings.useTrailingStop
        ? entryPrice * (1 - this.settings.trailingStopPct / 100)
        : null,
      pnl: 0,
      pnlPct: 0,
    };

    this.store.data.positions.push(position);
    this.store.save();
    riskManager.registerEntry({ venue: 'solana' });
    log.info(`ACHAT ${token.symbol} @ ${entryPrice} — ${sizeUsd}$ (score ${token.score}, ${origin})`);
    bus.emitEvent('sniper:entry', position);
    this.#broadcast();
    return position;
  }

  async #managePositions() {
    for (const position of [...this.store.data.positions]) {
      let price = position.currentPrice;
      try {
        const fresh = await refreshToken(position.address);
        if (fresh?.priceUsd > 0) price = fresh.priceUsd;
      } catch (err) {
        log.warn(`prix ${position.symbol} indisponible:`, err.message);
        continue;
      }

      position.currentPrice = price;
      position.pnlPct = round(pct(position.entryPrice, price), 2);
      position.pnl = round((price - position.entryPrice) * position.tokenAmount, 2);

      if (position.trailingPct && price > position.peakPrice) {
        position.peakPrice = price;
        position.trailingStop = price * (1 - position.trailingPct / 100);
      }

      let reason = null;
      if (price >= position.takeProfit) reason = 'take-profit';
      else if (price <= position.stopLoss) reason = 'stop-loss';
      else if (position.trailingStop && price <= position.trailingStop) {
        reason = price > position.entryPrice ? 'trailing-stop' : 'stop-loss';
      }

      if (reason) await this.sell(position.id, reason);
    }
    this.store.save();
  }

  async sell(id, reason = 'manuelle') {
    const index = this.store.data.positions.findIndex((p) => p.id === id);
    if (index === -1) throw Object.assign(new Error('Position introuvable'), { status: 404 });
    const position = this.store.data.positions[index];

    let price = position.currentPrice;
    let signature = null;
    try {
      const fresh = await refreshToken(position.address);
      if (fresh?.priceUsd > 0) price = fresh.priceUsd;
    } catch {
      /* on vend au dernier prix connu plutôt que de rester bloqué */
    }

    if (position.mode === 'live' && wallet.canTrade) {
      try {
        const result = await jupiter.sellToken({
          mint: position.address,
          rawAmount: position.rawAmount,
          // Slippage élargi à la vente : sortir compte plus que le prix exact.
          slippageBps: Math.max(this.settings.slippageBps, 500),
        });
        signature = result.signature;
        const solUsd = await this.solPrice();
        if (solUsd && position.tokenAmount > 0) {
          price = (result.outAmount * solUsd) / position.tokenAmount;
        }
      } catch (err) {
        log.error(`vente ${position.symbol} échouée:`, err.message);
        bus.emitEvent('sniper:sell-failed', { symbol: position.symbol, error: err.message });
        throw Object.assign(new Error(`Vente échouée: ${err.message}`), { status: 502 });
      }
    }

    const pnl = round((price - position.entryPrice) * position.tokenAmount, 2);
    const pnlPct = round(pct(position.entryPrice, price), 2);

    if (position.mode !== 'live') {
      this.store.data.demoBalance = round(this.store.data.demoBalance + position.size + pnl, 2);
    }

    const closed = {
      ...position,
      exitPrice: price,
      exitSignature: signature,
      closedAt: Date.now(),
      holdMs: Date.now() - position.openedAt,
      pnl,
      pnlPct,
      reason,
    };

    this.store.data.positions.splice(index, 1);
    this.store.data.closed.unshift(closed);
    if (this.store.data.closed.length > 200) this.store.data.closed.length = 200;
    this.store.save();

    riskManager.registerExit({
      venue: 'solana',
      symbol: position.symbol,
      score: position.score,
      pnl,
      pnlPct,
      reason,
      holdMs: closed.holdMs,
    });

    log.info(`VENTE ${position.symbol} @ ${price} — ${pnl >= 0 ? '+' : ''}${pnl}$ (${reason})`);
    bus.emitEvent('sniper:exit', closed);
    this.#broadcast();
    return closed;
  }

  async sellAll(reason = 'fermeture globale') {
    const out = [];
    for (const position of [...this.store.data.positions]) {
      try {
        out.push(await this.sell(position.id, reason));
      } catch (err) {
        log.error(`fermeture ${position.symbol}:`, err.message);
      }
    }
    return out;
  }

  resetDemo() {
    this.store.data.demoBalance = DEMO_START_USD;
    this.store.data.positions = this.store.data.positions.filter((p) => p.mode === 'live');
    this.store.data.closed = [];
    this.store.save();
    this.#broadcast();
  }

  snapshot() {
    const d = this.store.data;
    return {
      running: d.running,
      mode: d.mode,
      liveAllowed: wallet.canTrade && config.allowLiveTrading,
      wallet: wallet.status,
      settings: d.settings,
      demoBalance: d.demoBalance,
      openPnl: round(d.positions.reduce((a, p) => a + p.pnl, 0), 2),
      positions: d.positions,
      closed: d.closed.slice(0, 50),
      lastPoll: d.lastPoll,
      lastError: this.lastError,
      smartMoney: smartMoney.snapshot(),
      candidates: this.candidates.slice(0, 25).map((c) => ({
        address: c.address,
        symbol: c.symbol,
        name: c.name,
        dex: c.dex,
        url: c.url,
        priceUsd: c.priceUsd,
        liquidityUsd: round(c.liquidityUsd),
        marketCap: round(c.marketCap),
        volumeH1: round(c.volume.h1),
        changeM5: round(c.change.m5, 2),
        changeH1: round(c.change.h1, 2),
        ageMinutes: c.ageMinutes === null ? null : round(c.ageMinutes, 1),
        score: c.score,
        baseScore: c.baseScore,
        smartMoneyBonus: c.smartMoneyBonus,
        smartWallets: c.smartMoney.count,
        breakdown: c.breakdown,
        risks: c.risks,
        socials: c.socials,
      })),
    };
  }

  #broadcast() {
    bus.emitState('sniper', this.snapshot());
  }
}

export const sniper = new SolanaSniper();
