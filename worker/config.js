import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { SUPPORTED_TYPES } from './checkers.js';

export const DEFAULT_SETTINGS = Object.freeze({
  check_timeout: 10_000,
  history_max_days: 90,
  retries: 1,
  retry_delay: 2_000,
});

/**
 * Lädt und validiert die minimaid.config.yml.
 * Wirft einen Fehler mit allen gefundenen Problemen, statt still falsche Daten zu schreiben.
 */
export function loadConfig(path) {
  const raw = load(readFileSync(path, 'utf-8')) ?? {};
  return normalizeConfig(raw);
}

export function normalizeConfig(raw) {
  const errors = [];
  const services = Array.isArray(raw.services) ? raw.services : [];
  const seen = new Set();

  if (services.length === 0) errors.push('Es ist kein Service unter "services" konfiguriert.');

  services.forEach((svc, i) => {
    const where = `services[${i}]${svc?.name ? ` (${svc.name})` : ''}`;
    if (!svc || typeof svc !== 'object') {
      errors.push(`${where}: muss ein Objekt sein.`);
      return;
    }
    if (!svc.id) errors.push(`${where}: "id" fehlt.`);
    else if (seen.has(svc.id)) errors.push(`${where}: doppelte id "${svc.id}".`);
    else seen.add(svc.id);

    if (!svc.name) svc.name = svc.id;
    if (!SUPPORTED_TYPES.includes(svc.type)) {
      errors.push(`${where}: unbekannter Typ "${svc.type}". Erlaubt: ${SUPPORTED_TYPES.join(', ')}.`);
    }
    if ((svc.type === 'http' || svc.type === 'https') && !svc.url) {
      errors.push(`${where}: "url" fehlt.`);
    }
    if (svc.type !== 'http' && svc.type !== 'https' && !svc.host) {
      errors.push(`${where}: "host" fehlt.`);
    }
    if (svc.type === 'tcp' && !svc.port) {
      errors.push(`${where}: "port" fehlt.`);
    }
  });

  if (errors.length) {
    throw new Error(`Ungültige Konfiguration:\n  - ${errors.join('\n  - ')}`);
  }

  return {
    ...raw,
    site: raw.site ?? {},
    theme: raw.theme ?? {},
    services,
    notifications: raw.notifications ?? {},
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
  };
}

/**
 * Der Teil der Konfiguration, der öffentlich auf der Status-Seite landen darf.
 * Bewusst eine Whitelist: Hosts, Ports, Webhooks & Co. bleiben privat.
 */
export function toPublicConfig(config) {
  return {
    site: {
      title: config.site.title ?? 'Minimaid',
      description: config.site.description ?? 'Serverless Status Monitor',
      url: config.site.url ?? null,
    },
    theme: config.theme,
    services: config.services.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      ...(s.description ? { description: s.description } : {}),
      ...(s.link ? { link: s.link } : {}),
    })),
  };
}
