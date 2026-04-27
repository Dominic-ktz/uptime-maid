import { GameDig } from 'gamedig';

const DEFAULT_TIMEOUT = 10000;

export async function checkHttp(service, timeout = DEFAULT_TIMEOUT) {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const res = await fetch(service.url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Minimaid/1.0 StatusChecker' },
    });
    clearTimeout(timer);

    const responseTime = Date.now() - start;
    const expected = service.expectedStatus || 200;
    const online = res.status === expected;

    return {
      status: online ? 'online' : 'degraded',
      responseTime,
      details: { statusCode: res.status },
    };
  } catch (err) {
    return {
      status: 'offline',
      responseTime: Date.now() - start,
      details: { error: err.message },
    };
  }
}

export async function checkMinecraftJava(service, timeout = DEFAULT_TIMEOUT) {
  const start = Date.now();
  try {
    const result = await GameDig.query({
      type: 'minecraft',
      host: service.host,
      port: service.port || 25565,
      socketTimeout: timeout,
    });
    return {
      status: 'online',
      responseTime: Date.now() - start,
      details: {
        players: result.numplayers ?? result.players?.length ?? 0,
        maxPlayers: result.maxplayers ?? 0,
        motd: result.name || '',
        version: result.version || '',
      },
    };
  } catch (err) {
    return {
      status: 'offline',
      responseTime: Date.now() - start,
      details: { error: err.message },
    };
  }
}

export async function checkMinecraftBedrock(service, timeout = DEFAULT_TIMEOUT) {
  const start = Date.now();
  try {
    const result = await GameDig.query({
      type: 'minecraftbe',
      host: service.host,
      port: service.port || 19132,
      socketTimeout: timeout,
    });
    return {
      status: 'online',
      responseTime: Date.now() - start,
      details: {
        players: result.numplayers ?? result.players?.length ?? 0,
        maxPlayers: result.maxplayers ?? 0,
        motd: result.name || '',
        version: result.version || '',
      },
    };
  } catch (err) {
    return {
      status: 'offline',
      responseTime: Date.now() - start,
      details: { error: err.message },
    };
  }
}

export async function checkFiveM(service, timeout = DEFAULT_TIMEOUT) {
  const start = Date.now();
  const base = `http://${service.host}:${service.port || 30120}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const [infoRes, playersRes] = await Promise.all([
      fetch(`${base}/info.json`, { signal: controller.signal }),
      fetch(`${base}/players.json`, { signal: controller.signal }),
    ]);
    clearTimeout(timer);

    const info = await infoRes.json();
    const players = await playersRes.json();

    return {
      status: 'online',
      responseTime: Date.now() - start,
      details: {
        players: players.length,
        maxPlayers: info.vars?.sv_maxClients ?? 0,
        serverName: info.vars?.sv_projectName ?? '',
        gametype: info.vars?.gametype ?? '',
      },
    };
  } catch {
    try {
      const result = await GameDig.query({
        type: 'fivem',
        host: service.host,
        port: service.port || 30120,
        socketTimeout: timeout,
      });
      return {
        status: 'online',
        responseTime: Date.now() - start,
        details: {
          players: result.numplayers ?? result.players?.length ?? 0,
          maxPlayers: result.maxplayers ?? 0,
          serverName: result.name || '',
        },
      };
    } catch (err) {
      return {
        status: 'offline',
        responseTime: Date.now() - start,
        details: { error: err.message },
      };
    }
  }
}

const CHECKER_MAP = {
  'http': checkHttp,
  'https': checkHttp,
  'minecraft-java': checkMinecraftJava,
  'minecraft-bedrock': checkMinecraftBedrock,
  'fivem': checkFiveM,
};

export function getChecker(type) {
  return CHECKER_MAP[type] || null;
}
