#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INCIDENTS_PATH = resolve(__dirname, '..', 'data', 'incidents.json');

const VALID_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved', 'maintenance'];
const VALID_SEVERITIES = ['minor', 'major', 'critical', 'maintenance'];

function loadIncidents() {
  try {
    return JSON.parse(readFileSync(INCIDENTS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveIncidents(incidents) {
  writeFileSync(INCIDENTS_PATH, JSON.stringify(incidents, null, 2), 'utf-8');
}

function printHelp() {
  console.log(`
🧹 Minimaid – Incident CLI

Verwendung:
  node worker/incident-cli.js <befehl> [optionen]

Befehle:

  create --title "..." --severity minor|major|critical|maintenance [--services id1,id2] [--message "..."]
    Erstellt einen neuen Vorfall.

  update --id <incident-id> --status investigating|identified|monitoring|resolved|maintenance --message "..."
    Fügt ein Update zu einem bestehenden Vorfall hinzu.

  resolve --id <incident-id> [--message "..."]
    Markiert einen Vorfall als gelöst.

  list
    Zeigt alle aktiven Vorfälle.

  list-all
    Zeigt alle Vorfälle (inkl. gelöste).

Beispiele:
  node worker/incident-cli.js create --title "API Probleme" --severity major --services api --message "Erhöhte Fehlerrate bei der API"
  node worker/incident-cli.js update --id inc-1714250000 --status identified --message "Ursache gefunden: Datenbankverbindung"
  node worker/incident-cli.js resolve --id inc-1714250000 --message "Datenbankverbindung repariert"
`);
}

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      parsed[key] = val;
      if (val !== true) i++;
    }
  }
  return parsed;
}

function createIncident(opts) {
  if (!opts.title) {
    console.error('Fehler: --title ist erforderlich');
    process.exit(1);
  }

  const severity = opts.severity || 'minor';
  if (!VALID_SEVERITIES.includes(severity)) {
    console.error(`Fehler: Ungültige Severity "${severity}". Erlaubt: ${VALID_SEVERITIES.join(', ')}`);
    process.exit(1);
  }

  const incidents = loadIncidents();
  const now = new Date().toISOString();
  const id = `inc-${Date.now()}`;
  const services = opts.services ? opts.services.split(',').map(s => s.trim()) : [];

  const incident = {
    id,
    title: opts.title,
    status: severity === 'maintenance' ? 'maintenance' : 'investigating',
    severity,
    services,
    updates: [],
    createdAt: now,
  };

  if (opts.message) {
    incident.updates.push({
      timestamp: now,
      status: incident.status,
      message: opts.message,
    });
  }

  incidents.unshift(incident);
  saveIncidents(incidents);

  console.log(`✅ Vorfall erstellt: ${id}`);
  console.log(`   Titel:    ${opts.title}`);
  console.log(`   Severity: ${severity}`);
  console.log(`   Status:   ${incident.status}`);
  console.log(`\nVergiss nicht zu committen & pushen:`);
  console.log(`  git add data/incidents.json && git commit -m "incident: ${opts.title}" && git push`);
}

function updateIncident(opts) {
  if (!opts.id) {
    console.error('Fehler: --id ist erforderlich');
    process.exit(1);
  }
  if (!opts.status) {
    console.error('Fehler: --status ist erforderlich');
    process.exit(1);
  }
  if (!VALID_STATUSES.includes(opts.status)) {
    console.error(`Fehler: Ungültiger Status "${opts.status}". Erlaubt: ${VALID_STATUSES.join(', ')}`);
    process.exit(1);
  }

  const incidents = loadIncidents();
  const incident = incidents.find(i => i.id === opts.id);

  if (!incident) {
    console.error(`Fehler: Vorfall "${opts.id}" nicht gefunden`);
    process.exit(1);
  }

  const now = new Date().toISOString();
  incident.status = opts.status;
  incident.updates.push({
    timestamp: now,
    status: opts.status,
    message: opts.message || '',
  });

  saveIncidents(incidents);

  console.log(`✅ Vorfall aktualisiert: ${opts.id}`);
  console.log(`   Neuer Status: ${opts.status}`);
  if (opts.message) console.log(`   Nachricht:    ${opts.message}`);
  console.log(`\nVergiss nicht zu committen & pushen:`);
  console.log(`  git add data/incidents.json && git commit -m "incident-update: ${incident.title}" && git push`);
}

function resolveIncident(opts) {
  updateIncident({
    id: opts.id,
    status: 'resolved',
    message: opts.message || 'Vorfall behoben.',
  });
}

function listIncidents(showAll) {
  const incidents = loadIncidents();
  const filtered = showAll ? incidents : incidents.filter(i => i.status !== 'resolved');

  if (filtered.length === 0) {
    console.log(showAll ? 'Keine Vorfälle vorhanden.' : 'Keine aktiven Vorfälle. ✨');
    return;
  }

  console.log(`\n${'─'.repeat(60)}`);
  for (const inc of filtered) {
    const statusIcon = {
      investigating: '🔍',
      identified: '🔎',
      monitoring: '👀',
      resolved: '✅',
      maintenance: '🔧',
    }[inc.status] || '❓';

    console.log(`${statusIcon} [${inc.id}] ${inc.title}`);
    console.log(`   Status: ${inc.status} | Severity: ${inc.severity} | Erstellt: ${inc.createdAt}`);
    if (inc.services?.length) console.log(`   Services: ${inc.services.join(', ')}`);
    if (inc.updates?.length) {
      const last = inc.updates[inc.updates.length - 1];
      console.log(`   Letztes Update: ${last.message || '(kein Text)'} (${last.timestamp})`);
    }
    console.log(`${'─'.repeat(60)}`);
  }
}

const [,, command, ...rest] = process.argv;
const opts = parseArgs(rest);

switch (command) {
  case 'create': createIncident(opts); break;
  case 'update': updateIncident(opts); break;
  case 'resolve': resolveIncident(opts); break;
  case 'list': listIncidents(false); break;
  case 'list-all': listIncidents(true); break;
  default: printHelp();
}
