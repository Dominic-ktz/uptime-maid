import { Socket } from 'node:net';
import { GameDig } from 'gamedig';

const DEFAULT_TIMEOUT = 10_000;
const USER_AGENT = 'Minimaid/2.0 (+https://github.com/Dominic-ktz/uptime-maid)';

const ok = (start, details = {}) => ({ status: 'online', responseTime: Date.now() - start, details });
const fail = (start, err) => ({
  status: 'offline',
  responseTime: Date.now() - start,
  details: { error: describeError(err) },
});

function describeError(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'Timeout';
  const cause = err?.cause?.code || err?.cause?.message;
  return cause ? `${err.message} (${cause})` : String(err?.message ?? err);
}

function matchesExpectedStatus(code, expected) {
  if (expected === undefined || expected === null) return code >= 200 && code < 400;
  const list = Array.isArray(expected) ? expected : [expected];
  return list.map(Number).includes(code);
}

/**
 * HTTP(S)-Check.
 * Optionen: url, method (GET), expectedStatus (Zahl oder Liste, Standard 2xx/3xx), keyword, headers.
 * Antwortet der Server nicht wie erwartet, ist der Service "degraded", bei Netzwerkfehlern "offline".
 */
export async function checkHttp(service, timeout = DEFAULT_TIMEOUT) {
  const start = Date.now();
  const method = (service.method || 'GET').toUpperCase();
  try {
    const res = await fetch(service.url, {
      method,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
      headers: { 'User-Agent': USER_AGENT, ...(service.headers ?? {}) },
    });

    const responseTime = Date.now() - start;
    const details = { statusCode: res.status };
    let healthy = matchesExpectedStatus(res.status, service.expectedStatus);

    if (service.keyword && method !== 'HEAD') {
      const body = await res.text();
      const found = body.includes(service.keyword);
      details.keywordFound = found;
      healthy &&= found;
    } else {
      await res.body?.cancel();
    }

    return { status: healthy ? 'online' : 'degraded', responseTime, details };
  } catch (err) {
    return fail(start, err);
  }
}

/** Reiner TCP-Port-Check (z. B. für Datenbanken, SSH, TeamSpeak). */
export function checkTcp(service, timeout = DEFAULT_TIMEOUT) {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = new Socket();
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(ok(start)));
    socket.once('timeout', () => finish(fail(start, { name: 'TimeoutError' })));
    socket.once('error', (err) => finish(fail(start, err)));
    socket.connect(Number(service.port), service.host);
  });
}

async function queryGameDig(service, type, defaultPort, timeout) {
  const result = await GameDig.query({
    type,
    host: service.host,
    port: service.port || defaultPort,
    socketTimeout: timeout,
    attemptTimeout: timeout,
    maxRetries: 1,
  });
  return {
    players: result.numplayers ?? result.players?.length ?? 0,
    maxPlayers: result.maxplayers ?? 0,
    ...(result.name ? { motd: stripFormatting(result.name) } : {}),
    ...(result.version ? { version: result.version } : {}),
  };
}

/** Entfernt Minecraft-Farbcodes (§a, §l …) aus MOTDs. */
function stripFormatting(text) {
  return String(text).replace(/§[0-9a-fk-or]/gi, '').trim();
}

export async function checkMinecraftJava(service, timeout = DEFAULT_TIMEOUT) {
  const start = Date.now();
  try {
    return ok(start, await queryGameDig(service, 'minecraft', 25565, timeout));
  } catch (err) {
    return fail(start, err);
  }
}

export async function checkMinecraftBedrock(service, timeout = DEFAULT_TIMEOUT) {
  const start = Date.now();
  try {
    return ok(start, await queryGameDig(service, 'mbe', 19132, timeout));
  } catch (err) {
    return fail(start, err);
  }
}

export async function checkFiveM(service, timeout = DEFAULT_TIMEOUT) {
  const start = Date.now();
  const base = `http://${service.host}:${service.port || 30120}`;

  try {
    const signal = AbortSignal.timeout(timeout);
    const [info, players] = await Promise.all(
      ['info.json', 'players.json'].map(async (file) => {
        const res = await fetch(`${base}/${file}`, { signal, headers: { 'User-Agent': USER_AGENT } });
        if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
        return res.json();
      })
    );

    return ok(start, {
      players: Array.isArray(players) ? players.length : 0,
      maxPlayers: Number(info.vars?.sv_maxClients ?? 0),
      ...(info.vars?.sv_projectName ? { motd: stripFormatting(info.vars.sv_projectName) } : {}),
    });
  } catch {
    // Fallback: manche Server sperren die HTTP-Endpunkte, antworten aber auf GameDig.
    try {
      return ok(start, await queryGameDig(service, 'gta5f', 30120, timeout));
    } catch (err) {
      return fail(start, err);
    }
  }
}

const CHECKER_MAP = {
  http: checkHttp,
  https: checkHttp,
  tcp: checkTcp,
  'minecraft-java': checkMinecraftJava,
  'minecraft-bedrock': checkMinecraftBedrock,
  fivem: checkFiveM,
};

export const SUPPORTED_TYPES = Object.keys(CHECKER_MAP);

export function getChecker(type) {
  return CHECKER_MAP[type] ?? null;
}
