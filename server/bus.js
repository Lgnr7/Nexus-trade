import { EventEmitter } from 'node:events';

/**
 * Bus central : les bots publient, le serveur WebSocket et le notifier
 * consomment. Évite que les bots connaissent les clients connectés.
 */
class Bus extends EventEmitter {
  emitState(section, payload) {
    this.emit('state', { section, payload, ts: Date.now() });
  }

  emitLog(level, scope, message, meta) {
    this.emit('log', { level, scope, message, meta, ts: Date.now() });
  }

  /** Événement métier notable (entrée, sortie, snipe, limite de risque). */
  emitEvent(type, payload) {
    this.emit('event', { type, payload, ts: Date.now() });
  }
}

export const bus = new Bus();
// Beaucoup d'abonnés (ws, notifier, risk, learning) : la limite par défaut
// de 10 déclencherait un faux warning de fuite mémoire.
bus.setMaxListeners(50);
