const STATUS_COLORS = { online: 0x39ff14, offline: 0xff073a, degraded: 0xffbe0b };
const STATUS_EMOJI = { online: '🟢', offline: '🔴', degraded: '🟡' };
const STATUS_LABEL = { online: 'Online', offline: 'Offline', degraded: 'Beeinträchtigt' };
const TYPE_LABEL = {
  http: 'Website',
  https: 'Website',
  tcp: 'TCP-Dienst',
  'minecraft-java': 'Minecraft Java Server',
  'minecraft-bedrock': 'Minecraft Bedrock Server',
  fivem: 'FiveM Server',
};

/** Ersetzt ${VAR} durch Umgebungsvariablen. Gibt null zurück, wenn eine Variable fehlt. */
export function resolveEnvVars(str) {
  if (!str) return null;
  let missing = false;
  const resolved = String(str).replace(/\$\{(\w+)\}/g, (_, key) => {
    if (!process.env[key]) missing = true;
    return process.env[key] ?? '';
  });
  return missing ? null : resolved;
}

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function buildDiscordPayload(config, service, change, result) {
  const discord = config.notifications?.discord ?? {};
  const fields = [
    { name: 'Vorher', value: STATUS_LABEL[change.from] ?? 'Unbekannt', inline: true },
    { name: 'Jetzt', value: STATUS_LABEL[change.to] ?? change.to, inline: true },
    { name: 'Antwortzeit', value: `${result.responseTime} ms`, inline: true },
  ];

  const d = result.details ?? {};
  if (d.statusCode) fields.push({ name: 'HTTP-Status', value: String(d.statusCode), inline: true });
  if (d.players !== undefined) {
    fields.push({ name: 'Spieler', value: `${d.players}/${d.maxPlayers || '?'}`, inline: true });
  }
  if (d.error) fields.push({ name: 'Fehler', value: `\`${truncate(d.error, 1000)}\``, inline: false });

  const siteUrl = config.site?.url;

  return {
    username: discord.username || 'Minimaid',
    ...(discord.avatar_url ? { avatar_url: discord.avatar_url } : {}),
    embeds: [{
      title: truncate(`${STATUS_EMOJI[change.to] ?? '⚪'} ${service.name} ist ${STATUS_LABEL[change.to] ?? change.to}`, 256),
      description: `**${TYPE_LABEL[service.type] ?? 'Service'}** \`${service.name}\` hat den Status gewechselt.`,
      color: STATUS_COLORS[change.to] ?? 0xffffff,
      fields,
      ...(siteUrl ? { url: siteUrl } : {}),
      footer: { text: 'Minimaid Status Monitor' },
      timestamp: new Date().toISOString(),
    }],
  };
}

export async function sendDiscordNotification(config, service, change, result) {
  const discord = config.notifications?.discord;
  if (!discord?.enabled) return;

  const webhookUrl = resolveEnvVars(discord.webhook_url);
  if (!webhookUrl) {
    console.warn('[Minimaid] Discord ist aktiviert, aber die Webhook-URL fehlt (Secret DISCORD_WEBHOOK_URL gesetzt?).');
    return;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildDiscordPayload(config, service, change, result)),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[Minimaid] Discord-Webhook fehlgeschlagen: ${res.status} ${res.statusText}`);
    } else {
      console.log(`[Minimaid] Discord-Benachrichtigung gesendet für ${service.name}`);
    }
  } catch (err) {
    console.error(`[Minimaid] Discord-Webhook-Fehler: ${err.message}`);
  }
}
