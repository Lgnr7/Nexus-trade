import { $, el, clockTime } from '../util.js';

const MAX_LINES = 600;

/** Flux de logs serveur, avec suivi automatique optionnel. */
export function createLogsView() {
  const output = $('#logOutput');
  const autoscroll = $('#logAutoscroll');

  $('#logClear').addEventListener('click', () => output.replaceChildren());

  const append = (entry) => {
    const line = el('div', { class: 'log-line', dataset: { level: entry.level } }, [
      el('span', { class: 'log-line__time', text: clockTime(entry.ts) }),
      el('span', { class: 'log-line__scope', text: entry.scope }),
      el('span', { class: 'log-line__msg', text: entry.message }),
    ]);
    output.append(line);
    while (output.children.length > MAX_LINES) output.firstChild.remove();
    if (autoscroll.checked) output.scrollTop = output.scrollHeight;
  };

  return {
    append,
    replaceAll(entries) {
      output.replaceChildren();
      for (const entry of entries) append(entry);
    },
  };
}
