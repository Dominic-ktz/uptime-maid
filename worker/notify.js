const STATUS_COLORS = {
  online: 0x39ff14,
  offline: 0xff073a,
  degraded: 0xffbe0b,
};

const STATUS_EMOJI = {
  online: '🟢',
  offline: '🔴',
  degraded: '🟡',
};

export async function sendDiscordNotification(config, service, oldStatus, newStatus, details) {
  const discord = config.notifications?.discord;
  if (!discord?.enabled) return;

  const webhookUrl = resolveEnvVars(discord.webhook_url);
  if (!webhookUrl || webhookUrl.includes('${')) return;

  const embed = {
    title: `${STATUS_EMOJI[newStatus]} Statuswechsel: ${service.name}`,
    description: buildDescription(service, oldStatus, newStatus, details),
    color: STATUS_COLORS[newStatus] || 0xffffff,
    fields: buildFields(service, details),
    footer: { text: 'Minimaid Status Monitor' },
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: discord.username || 'Minimaid',
        avatar_url: discord.avatar_url || undefined,
        embeds: [embed],
      }),
    });

    if (!res.ok) {
      console.error(`[Minimaid] Discord Webhook fehlgeschlagen: ${res.status} ${res.statusText}`);
    } else {
      console.log(`[Minimaid] Discord-Benachrichtigung gesendet für ${service.name}`);
    }
  } catch (err) {
    console.error(`[Minimaid] Discord Webhook Fehler: ${err.message}`);
  }
}

function buildDescription(service, oldStatus, newStatus, _details) {
  const typeLabel = {
    'http': 'Website',
    'https': 'Website',
    'minecraft-java': 'Minecraft Java Server',
    'minecraft-bedrock': 'Minecraft Bedrock Server',
    'fivem': 'FiveM Server',
  };
  const label = typeLabel[service.type] || 'Service';
  return `**${label}** \`${service.name}\` ist jetzt **${newStatus.toUpperCase()}**\n` +
    `Vorheriger Status: ${oldStatus || 'unbekannt'}`;
}

function buildFields(service, details) {
  const fields = [];
  if (details.responseTime !== undefined) {
    fields.push({ name: 'Antwortzeit', value: `${details.responseTime}ms`, inline: true });
  }
  if (details.details?.players !== undefined) {
    fields.push({
      name: 'Spieler',
      value: `${details.details.players}/${details.details.maxPlayers || '?'}`,
      inline: true,
    });
  }
  if (details.details?.error) {
    fields.push({ name: 'Fehler', value: `\`${details.details.error}\``, inline: false });
  }
  if (service.url) {
    fields.push({ name: 'URL', value: service.url, inline: false });
  } else if (service.host) {
    fields.push({ name: 'Host', value: `${service.host}:${service.port}`, inline: false });
  }
  return fields;
}

function resolveEnvVars(str) {
  if (!str) return str;
  return str.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] || `\${${key}}`);
}
