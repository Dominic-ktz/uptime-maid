import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig, toPublicConfig } from './config.js';
import { getChecker } from './checkers.js';
import { sendDiscordNotification } from './notify.js';
import { loadHistory, recordCheck, pruneHistory, serializeHistory, writeFileAtomic } from './history.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = resolve(ROOT, 'minimaid.config.yml');
const DATA_DIR = resolve(ROOT, 'data');
const HISTORY_PATH = resolve(DATA_DIR, 'history.json');
const PUBLIC_CONFIG_PATH = resolve(DATA_DIR, 'config.json');

/** Führt einen Check aus und wiederholt ihn bei Fehlschlag, um Fehlalarme zu vermeiden. */
async function runCheck(service, settings) {
  const checker = getChecker(service.type);
  let result;
  for (let attempt = 0; attempt <= settings.retries; attempt++) {
    if (attempt > 0) await sleep(settings.retry_delay);
    result = await checker(service, settings.check_timeout);
    if (result.status === 'online') break;
  }
  return result;
}

async function main() {
  console.log('[Minimaid] Worker gestartet –', new Date().toISOString());

  const config = loadConfig(CONFIG_PATH);
  const { settings } = config;
  const history = loadHistory(HISTORY_PATH);

  // Alle Services parallel prüfen – ein langsamer Server bremst die anderen nicht mehr aus.
  const results = await Promise.all(config.services.map((svc) => runCheck(svc, settings)));
  const now = new Date().toISOString();

  for (const [i, service] of config.services.entries()) {
    const result = results[i];
    const extra = result.details?.error ? ` – ${result.details.error}` : '';
    console.log(`[Minimaid] ${service.name} (${service.type}): ${result.status}, ${result.responseTime} ms${extra}`);

    const change = recordCheck(history, service, result, now);
    if (change) {
      console.log(`  ⚡ Statuswechsel: ${change.from ?? 'neu'} → ${change.to}`);
      await sendDiscordNotification(config, service, change, result);
    }
  }

  pruneHistory(history, settings.history_max_days, config.services.map((s) => s.id));
  history.lastUpdated = now;

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(HISTORY_PATH, serializeHistory(history));
  writeFileAtomic(PUBLIC_CONFIG_PATH, `${JSON.stringify(toPublicConfig(config), null, 2)}\n`);
  console.log('[Minimaid] Daten gespeichert. Worker beendet.');
}

main().catch((err) => {
  console.error('[Minimaid] Fataler Fehler:', err.message ?? err);
  process.exit(1);
});
