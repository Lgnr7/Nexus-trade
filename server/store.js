import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('store');

/**
 * Persistance simple sur disque : un fichier JSON par domaine, écriture
 * atomique (tmp + rename) pour qu'un redémarrage en plein write ne laisse
 * jamais un fichier tronqué. Les écritures sont regroupées (debounce 300 ms)
 * car les bots modifient l'état plusieurs fois par seconde.
 */
export class Store {
  #file;
  #data;
  #timer = null;
  #writing = null;

  constructor(name, defaults) {
    this.#file = path.join(config.dataDir, `${name}.json`);
    this.#data = structuredClone(defaults);
    this.defaults = structuredClone(defaults);
    this.name = name;
  }

  load() {
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      if (fs.existsSync(this.#file)) {
        const parsed = JSON.parse(fs.readFileSync(this.#file, 'utf8'));
        this.#data = { ...structuredClone(this.defaults), ...parsed };
        log.info(`${this.name} rechargé depuis le disque`);
      }
    } catch (err) {
      // Un fichier corrompu ne doit pas empêcher le serveur de démarrer :
      // on repart des valeurs par défaut et on garde une copie pour analyse.
      log.error(`${this.name} illisible, réinitialisation :`, err.message);
      try {
        fs.renameSync(this.#file, `${this.#file}.corrupt-${Date.now()}`);
      } catch {
        /* le fichier n'existe peut-être déjà plus */
      }
    }
    return this.#data;
  }

  get data() {
    return this.#data;
  }

  update(mutator) {
    const result = mutator(this.#data);
    this.save();
    return result;
  }

  save() {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#writing = this.#flush().catch((err) =>
        log.error(`échec écriture ${this.name}:`, err.message),
      );
    }, 300);
  }

  async #flush() {
    const tmp = `${this.#file}.tmp`;
    await fsp.mkdir(config.dataDir, { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(this.#data, null, 2), 'utf8');
    await fsp.rename(tmp, this.#file);
  }

  /** À appeler avant un arrêt propre pour ne pas perdre le dernier delta. */
  async flushNow() {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    await this.#writing;
    await this.#flush();
  }
}
