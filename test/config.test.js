import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, normalizeConfig, toPublicConfig } from '../worker/config.js';

test('die mitgelieferte minimaid.config.yml ist gültig', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const config = loadConfig(resolve(root, 'minimaid.config.yml'));
  assert.ok(config.services.length > 0);
});

test('fehlerhafte Services werden gesammelt gemeldet', () => {
  assert.throws(
    () => normalizeConfig({ services: [
      { id: 'a', type: 'http', url: 'https://a' },
      { id: 'a', type: 'http' },
      { id: 'b', type: 'gopher', host: 'x' },
    ] }),
    (err) => /doppelte id/.test(err.message) && /"url" fehlt/.test(err.message) && /unbekannter Typ/.test(err.message),
  );
});

test('öffentliche Config enthält keine Hosts oder Webhooks', () => {
  const config = normalizeConfig({
    services: [{ id: 'mc', name: 'MC', type: 'minecraft-java', host: 'secret.example', port: 25565 }],
    notifications: { discord: { webhook_url: 'https://discord/secret' } },
  });
  const json = JSON.stringify(toPublicConfig(config));
  assert.doesNotMatch(json, /secret/);
  assert.equal(toPublicConfig(config).services[0].name, 'MC');
});
