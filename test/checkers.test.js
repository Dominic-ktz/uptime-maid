import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { checkHttp, checkTcp } from '../worker/checkers.js';

let server;
let base;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/slow') return setTimeout(() => res.end('late'), 500);
    if (req.url === '/missing') { res.statusCode = 404; return res.end('nope'); }
    res.end('Hallo Minimaid');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('HTTP: 200 ist online', async () => {
  const r = await checkHttp({ url: `${base}/` });
  assert.equal(r.status, 'online');
  assert.equal(r.details.statusCode, 200);
});

test('HTTP: falscher Statuscode ist degraded', async () => {
  assert.equal((await checkHttp({ url: `${base}/missing` })).status, 'degraded');
  assert.equal((await checkHttp({ url: `${base}/missing`, expectedStatus: [200, 404] })).status, 'online');
});

test('HTTP: Keyword-Prüfung', async () => {
  assert.equal((await checkHttp({ url: `${base}/`, keyword: 'Minimaid' })).status, 'online');
  const r = await checkHttp({ url: `${base}/`, keyword: 'Kaputt' });
  assert.equal(r.status, 'degraded');
  assert.equal(r.details.keywordFound, false);
});

test('HTTP: Timeout ist offline', async () => {
  const r = await checkHttp({ url: `${base}/slow` }, 100);
  assert.equal(r.status, 'offline');
  assert.equal(r.details.error, 'Timeout');
});

test('TCP: offener und geschlossener Port', async () => {
  const port = server.address().port;
  assert.equal((await checkTcp({ host: '127.0.0.1', port })).status, 'online');
  assert.equal((await checkTcp({ host: '127.0.0.1', port: 1 }, 1000)).status, 'offline');
});
