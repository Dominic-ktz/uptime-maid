# 🧹 Minimaid – Serverless Status Monitor

Ein moderner, kostenloser Status-Monitor mit Neon-Cyberpunk-Design.
Gehostet auf GitHub Pages, angetrieben durch GitHub Actions – ganz ohne eigenen Server.

**Minimaid** prüft deine Services (Websites, TCP-Dienste, Minecraft-Server, FiveM-Server) per geplantem Workflow,
speichert die Ergebnisse als JSON im Repository und veröffentlicht daraus eine statische Status-Seite.

---

## Features

- **Multi-Service Monitoring** – HTTP/HTTPS (inkl. Keyword-Check), TCP-Ports, Minecraft (Java & Bedrock), FiveM
- **Weniger Fehlalarme** – fehlgeschlagene Checks werden automatisch wiederholt, alle Services laufen parallel
- **Neon Cyberpunk UI** – ohne Build-Schritt, ohne Tailwind-CDN, responsive und barrierearm
- **Theme aus der Config** – Titel, Beschreibung und Farben kommen direkt aus `minimaid.config.yml`
- **Interaktive Charts** – Uptime & Antwortzeiten über 24h / 7 / 30 / 90 Tage
- **30-Tage-Uptime-Balken** – tagesgenauer Verlauf pro Service, Uptime für 24h und 30 Tage
- **Automatische Vorfälle** – ein Vorfall pro Störung, mit Dauer und Fehlermeldung, wird bei Erholung geschlossen
- **Manuelle Vorfälle & Wartungen** – per CLI, inklusive Update-Timeline
- **Discord-Alerts** – Webhook-Benachrichtigung bei jedem Statuswechsel
- **Auto-Refresh** – die Seite lädt die Daten jede Minute neu und warnt bei veralteten Daten

---

## Schnellstart

### 1. Repository forken / klonen

```bash
git clone https://github.com/DEIN-USER/uptime-maid.git
cd uptime-maid
npm install
```

Benötigt Node.js 22 oder neuer (die Pipeline nutzt die Version aus `.nvmrc`).

### 2. Services konfigurieren

Bearbeite `minimaid.config.yml`:

```yaml
services:
  - id: "meine-website"
    name: "Meine Website"
    type: "http"
    url: "https://example.com"
    link: "https://example.com"     # optional: Name auf der Status-Seite verlinken

  - id: "api"
    name: "API"
    type: "http"
    url: "https://api.example.com/health"
    expectedStatus: [200, 204]      # optional, Standard: jeder 2xx/3xx-Status
    keyword: "ok"                   # optional: Antwort muss diesen Text enthalten

  - id: "mc-server"
    name: "Minecraft Server"
    type: "minecraft-java"
    host: "mc.example.com"
    port: 25565

  - id: "fivem-server"
    name: "FiveM Server"
    type: "fivem"
    host: "fivem.example.com"
    port: 30120

  - id: "datenbank"
    name: "Datenbank"
    type: "tcp"
    host: "db.example.com"
    port: 5432
```

Die Config wird bei jedem Lauf validiert (doppelte IDs, fehlende Felder, unbekannte Typen) – Fehler stehen im Workflow-Log.

### 3. Discord Webhook (optional)

1. Discord: **Servereinstellungen → Integrationen → Webhooks → Neuer Webhook**, URL kopieren
2. GitHub: **Settings → Secrets and variables → Actions → New repository secret**
3. Name `DISCORD_WEBHOOK_URL`, Wert: die Webhook-URL
4. In der Config `notifications.discord.enabled: true` setzen

### 4. GitHub Pages aktivieren

**Settings → Pages → Source: GitHub Actions**. Der Workflow deployed nach jedem Check automatisch.

### 5. Workflow starten

Läuft automatisch nach Zeitplan und bei jedem Push auf `main`, der Seite, Worker oder Config ändert.
Manuell: **Actions → Minimaid Status Check → Run workflow**.

> **Hinweis:** GitHub führt geplante Workflows nur „best effort“ aus. Statt alle 5 Minuten laufen
> die Checks bei hoher Last oft nur alle 15 Minuten bis wenige Stunden. Für engmaschiges Monitoring
> kann man den Workflow zusätzlich extern per `workflow_dispatch` anstoßen (z. B. über einen Cron-Dienst).

---

## Vorfälle & Wartungen

```bash
npm run incident -- create --title "API Probleme" --severity major --services api --message "Erhöhte Fehlerrate"
npm run incident -- update --id inc-1714250000 --status identified --message "Ursache gefunden"
npm run incident -- resolve --id inc-1714250000 --message "Behoben"
npm run incident -- create --title "Server-Update" --severity maintenance --message "Ca. 30 Minuten Downtime"
npm run incident -- list
```

Danach `data/incidents.json` committen und pushen – die Seite wird automatisch neu deployed.
Aktive Vorfälle erscheinen oben unter dem Gesamtstatus, Wartungen färben den Banner blau.

---

## Projektstruktur

```
uptime-maid/
├── .github/workflows/
│   ├── minimaid.yml          # Checks, Commit der Daten, Pages-Deploy
│   └── ci.yml                # Tests & Audit für Branches/PRs
├── worker/
│   ├── index.js              # Einstiegspunkt des Workers
│   ├── config.js             # Config laden, validieren, öffentlichen Teil exportieren
│   ├── checkers.js           # HTTP, TCP, Minecraft, FiveM
│   ├── history.js            # History, automatische Vorfälle, Aufräumen
│   ├── notify.js             # Discord-Webhook
│   └── incident-cli.js       # CLI für manuelle Vorfälle
├── data/
│   ├── history.json          # Check-Verlauf (von der Pipeline geschrieben)
│   ├── config.json           # Öffentlicher Teil der Config (von der Pipeline geschrieben)
│   └── incidents.json        # Manuelle Vorfälle
├── test/                     # node:test – `npm test`
├── css/style.css
├── js/app.js
├── index.html
└── minimaid.config.yml       # Zentrale Konfiguration
```

Auf GitHub Pages landen nur `index.html`, `css/`, `js/` und `data/`. Hosts, Ports und Webhooks aus der
Config werden **nicht** veröffentlicht – `data/config.json` enthält nur Titel, Theme sowie ID, Name und Typ der Services.

---

## Unterstützte Service-Typen

| Typ                 | Beschreibung                      | Pflichtfelder                | Optional                                         |
|---------------------|-----------------------------------|------------------------------|--------------------------------------------------|
| `http` / `https`    | Website / API Health-Check        | `url`                        | `expectedStatus`, `method`, `keyword`, `headers` |
| `tcp`               | Offener TCP-Port                  | `host`, `port`               |                                                  |
| `minecraft-java`    | Minecraft Java Edition Server     | `host`                       | `port` (25565)                                   |
| `minecraft-bedrock` | Minecraft Bedrock Edition Server  | `host`                       | `port` (19132)                                   |
| `fivem`             | FiveM (GTA V) Server              | `host`                       | `port` (30120)                                   |

Alle Typen unterstützen zusätzlich `description` und `link` für die Anzeige.

**Status:** `online` = alles gut · `degraded` = erreichbar, aber falscher Statuscode / Keyword fehlt · `offline` = nicht erreichbar.

---

## Lokale Entwicklung

```bash
npm run check   # Worker einmal ausführen (schreibt data/)
npm run dev     # Seite unter http://localhost:3000 öffnen
npm test        # Tests
```

---

## Einstellungen

```yaml
settings:
  check_timeout: 10000     # Timeout pro Check in ms
  history_max_days: 90     # Aufbewahrung der History in Tagen
  retries: 1               # Wiederholungen, bevor ein Service als gestört gilt
  retry_delay: 2000        # Pause zwischen Wiederholungen in ms
```

---

## Lizenz

MIT
