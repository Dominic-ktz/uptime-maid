import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyHistory, recordCheck, pruneHistory, serializeHistory } from '../worker/history.js';

const svc = { id: 'web', name: 'Website', type: 'http' };
const res = (status, extra = {}) => ({ status, responseTime: 100, details: extra });

test('erster Online-Check erzeugt keinen Vorfall', () => {
  const h = emptyHistory();
  assert.equal(recordCheck(h, svc, res('online'), '2026-01-01T00:00:00.000Z'), null);
  assert.equal(h.incidents.length, 0);
  assert.equal(h.services.web.checks.length, 1);
  assert.equal('details' in h.services.web.checks[0], false, 'leere details werden weggelassen');
});

test('Ausfall öffnet einen Vorfall, Erholung schließt denselben', () => {
  const h = emptyHistory();
  recordCheck(h, svc, res('online'), '2026-01-01T00:00:00.000Z');
  const down = recordCheck(h, svc, res('offline', { error: 'Timeout' }), '2026-01-01T00:05:00.000Z');
  assert.deepEqual(down, { from: 'online', to: 'offline' });
  assert.equal(h.incidents.length, 1);
  assert.equal(h.incidents[0].resolvedAt, null);
  assert.equal(h.incidents[0].error, 'Timeout');

  recordCheck(h, svc, res('degraded'), '2026-01-01T00:10:00.000Z');
  assert.equal(h.incidents.length, 1, 'offline → degraded bleibt derselbe Vorfall');
  assert.match(h.incidents[0].title, /beeinträchtigt/);

  const up = recordCheck(h, svc, res('online'), '2026-01-01T00:15:00.000Z');
  assert.deepEqual(up, { from: 'degraded', to: 'online' });
  assert.equal(h.incidents.length, 1);
  assert.equal(h.incidents[0].status, 'resolved');
  assert.equal(h.incidents[0].resolvedAt, '2026-01-01T00:15:00.000Z');
});

test('erster Check offline öffnet direkt einen Vorfall', () => {
  const h = emptyHistory();
  assert.deepEqual(recordCheck(h, svc, res('offline'), '2026-01-01T00:00:00.000Z'), { from: null, to: 'offline' });
  assert.equal(h.incidents.length, 1);
});

test('pruneHistory entfernt alte Daten, behält offene Vorfälle', () => {
  const h = emptyHistory();
  h.services.web = { checks: [
    { timestamp: '2025-01-01T00:00:00.000Z', status: 'online', responseTime: 1 },
    { timestamp: '2026-01-10T00:00:00.000Z', status: 'online', responseTime: 1 },
  ] };
  h.services.removed = { checks: [{ timestamp: '2025-01-01T00:00:00.000Z', status: 'online', responseTime: 1 }] };
  h.incidents = [
    { id: 'old', startedAt: '2025-01-01T00:00:00.000Z', resolvedAt: '2025-01-01T01:00:00.000Z' },
    { id: 'open', startedAt: '2025-01-01T00:00:00.000Z', resolvedAt: null },
  ];
  pruneHistory(h, 30, ['web'], new Date('2026-01-15T00:00:00.000Z'));
  assert.equal(h.services.web.checks.length, 1);
  assert.equal('removed' in h.services, false);
  assert.deepEqual(h.incidents.map((i) => i.id), ['open']);
});

test('serializeHistory erzeugt gültiges JSON', () => {
  const h = emptyHistory();
  h.lastUpdated = '2026-01-01T00:00:00.000Z';
  assert.deepEqual(JSON.parse(serializeHistory(h)), h);
  recordCheck(h, svc, res('online', { statusCode: 200 }), '2026-01-01T00:00:00.000Z');
  recordCheck(h, svc, res('offline'), '2026-01-01T00:05:00.000Z');
  h.services.empty = { checks: [] };
  assert.deepEqual(JSON.parse(serializeHistory(h)), h);
});
