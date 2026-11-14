#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { writeFileAtomic } from './history.js';

const INCIDENTS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'incidents.json');

const VALID_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved', 'maintenance'];
const VALID_SEVERITIES = ['minor', 'major', 'critical', 'maintenance'];
const STATUS_ICON = { investigating: '🔍', identified: '🔎', monitoring: '👀', resolved: '✅', maintenance: '🔧' };

const HELP = `
🧹 Minimaid – Incident CLI

Verwendung:
  npm run incident -- <befehl> [optionen]

Befehle:
  create   --title "..." [--severity minor|major|critical|maintenance] [--services id1,id2] [--message "..."]
  update   --id <incident-id> --status ${VALID_STATUSES.join('|')} [--message "..."]
  resolve  --id <incident-id> [--message "..."]
  list     Aktive Vorfälle anzeigen
  list-all Alle Vorfälle anzeigen (inkl. gelöste)

Beispiele:
  npm run incident -- create --title "API Probleme" --severity major --services api --message "Erhöhte Fehlerrate"
  npm run incident -- update --id inc-1714250000 --status identified --message "Ursache: Datenbankverbindung"
  npm run incident -- resolve --id inc-1714250000 --message "Datenbankverbindung repariert"
`;

function fail(message) {
  console.error(`Fehler: ${message}`);
  process.exit(1);
}

function loadIncidents() {
  if (!existsSync(INCIDENTS_PATH)) return [];
  try {
    const data = JSON.parse(readFileSync(INCIDENTS_PATH, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return fail(`${INCIDENTS_PATH} ist kein gültiges JSON (${err.message}).`);
  }
}

function saveIncidents(incidents) {
  writeFileAtomic(INCIDENTS_PATH, `${JSON.stringify(incidents, null, 2)}\n`);
}

function remindCommit(message) {
  console.log('\nVergiss nicht zu committen & pushen:');
  console.log(`  git add data/incidents.json && git commit -m ${JSON.stringify(message)} && git push`);
}

function createIncident(opts) {
  if (!opts.title) fail('--title ist erforderlich');
  const severity = opts.severity ?? 'minor';
  if (!VALID_SEVERITIES.includes(severity)) {
    fail(`Ungültige Severity "${severity}". Erlaubt: ${VALID_SEVERITIES.join(', ')}`);
  }

  const now = new Date().toISOString();
  const status = severity === 'maintenance' ? 'maintenance' : 'investigating';
  const incident = {
    id: `inc-${Date.now()}`,
    title: opts.title,
    status,
    severity,
    services: opts.services ? opts.services.split(',').map((s) => s.trim()).filter(Boolean) : [],
    updates: opts.message ? [{ timestamp: now, status, message: opts.message }] : [],
    createdAt: now,
  };

  const incidents = loadIncidents();
  incidents.unshift(incident);
  saveIncidents(incidents);

  console.log(`✅ Vorfall erstellt: ${incident.id}`);
  console.log(`   Titel:    ${incident.title}`);
  console.log(`   Severity: ${severity}`);
  console.log(`   Status:   ${status}`);
  remindCommit(`incident: ${incident.title}`);
}

function updateIncident(opts) {
  if (!opts.id) fail('--id ist erforderlich');
  if (!opts.status) fail('--status ist erforderlich');
  if (!VALID_STATUSES.includes(opts.status)) {
    fail(`Ungültiger Status "${opts.status}". Erlaubt: ${VALID_STATUSES.join(', ')}`);
  }

  const incidents = loadIncidents();
  const incident = incidents.find((i) => i.id === opts.id);
  if (!incident) fail(`Vorfall "${opts.id}" nicht gefunden`);

  const now = new Date().toISOString();
  incident.status = opts.status;
  incident.updates ??= [];
  incident.updates.push({ timestamp: now, status: opts.status, message: opts.message ?? '' });
  if (opts.status === 'resolved') incident.resolvedAt = now;
  saveIncidents(incidents);

  console.log(`✅ Vorfall aktualisiert: ${opts.id}`);
  console.log(`   Neuer Status: ${opts.status}`);
  if (opts.message) console.log(`   Nachricht:    ${opts.message}`);
  remindCommit(`incident-update: ${incident.title}`);
}

function listIncidents(showAll) {
  const incidents = loadIncidents().filter((i) => showAll || i.status !== 'resolved');
  if (!incidents.length) {
    console.log(showAll ? 'Keine Vorfälle vorhanden.' : 'Keine aktiven Vorfälle. ✨');
    return;
  }

  const line = '─'.repeat(60);
  console.log(`\n${line}`);
  for (const inc of incidents) {
    console.log(`${STATUS_ICON[inc.status] ?? '❓'} [${inc.id}] ${inc.title}`);
    console.log(`   Status: ${inc.status} | Severity: ${inc.severity} | Erstellt: ${inc.createdAt}`);
    if (inc.services?.length) console.log(`   Services: ${inc.services.join(', ')}`);
    const last = inc.updates?.at(-1);
    if (last) console.log(`   Letztes Update: ${last.message || '(kein Text)'} (${last.timestamp})`);
    console.log(line);
  }
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      title: { type: 'string' },
      severity: { type: 'string' },
      services: { type: 'string' },
      message: { type: 'string' },
      id: { type: 'string' },
      status: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (err) {
  fail(err.message);
}

const { values: opts, positionals: [command] } = parsed;

switch (opts.help ? 'help' : command) {
  case 'create': createIncident(opts); break;
  case 'update': updateIncident(opts); break;
  case 'resolve': updateIncident({ ...opts, status: 'resolved', message: opts.message ?? 'Vorfall behoben.' }); break;
  case 'list': listIncidents(false); break;
  case 'list-all': listIncidents(true); break;
  default: console.log(HELP);
}
