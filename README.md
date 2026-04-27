# 🧹 Minimaid – Serverless Status Monitor

Ein moderner, kostenloser Status-Monitor mit Neon-Cyberpunk-Design.
Gehostet auf GitHub Pages, angetrieben durch GitHub Actions.

**Minimaid** checkt deine Services (Websites, Minecraft-Server, FiveM-Server) alle 5 Minuten per CI/CD-Pipeline – ganz ohne eigenen Server.

---

## Features

- **Multi-Service Monitoring** – HTTP/HTTPS, Minecraft (Java & Bedrock), FiveM
- **Neon Cyberpunk UI** – Dark Mode, Glow-Effekte, pulsende Status-Indikatoren
- **Interaktive Charts** – Uptime & Antwortzeiten über 24h / 7 Tage / 30 Tage / 90 Tage
- **Uptime-Bars** – Visueller 48h-Verlauf pro Service
- **Incident-Tracking** – Automatische Vorfälle bei Statuswechsel
- **Discord-Alerts** – Webhook-Benachrichtigung bei Online ↔ Offline
- **100% Serverless** – GitHub Actions als Worker, GitHub Pages als Hosting
- **Einfache Konfiguration** – Eine einzige `minimaid.config.yml`

---

## Schnellstart

### 1. Repository erstellen

```bash
# Repository klonen / forken
git clone https://github.com/DEIN-USER/MiniMaid.git
cd MiniMaid

# Abhängigkeiten installieren
npm install
```

### 2. Services konfigurieren

Bearbeite `minimaid.config.yml` und trage deine Services ein:

```yaml
services:
  - id: "meine-website"
    name: "Meine Website"
    type: "http"
    url: "https://example.com"
    expectedStatus: 200

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
```

### 3. Discord Webhook (optional)

1. In deinem Discord-Server: **Servereinstellungen → Integrationen → Webhooks → Neuer Webhook**
2. Webhook-URL kopieren
3. Im GitHub-Repository: **Settings → Secrets and variables → Actions → New repository secret**
4. Name: `DISCORD_WEBHOOK_URL`, Wert: deine Webhook-URL

### 4. GitHub Pages aktivieren

1. **Settings → Pages → Source**: wähle **GitHub Actions**
2. Der Workflow deployed automatisch bei jedem Check

### 5. Workflow starten

Der Workflow läuft automatisch alle 5 Minuten. Manuell starten:

**Actions → Minimaid Status Check → Run workflow**

---

## Projektstruktur

```
MiniMaid/
├── .github/workflows/
│   └── minimaid.yml          # GitHub Actions Workflow
├── worker/
│   ├── index.js              # Hauptskript (der "Worker")
│   ├── checkers.js           # Service-Checker (HTTP, MC, FiveM)
│   └── notify.js             # Discord-Webhook
├── data/
│   └── history.json          # Status-History (von der Pipeline beschrieben)
├── css/
│   └── style.css             # Neon-Cyberpunk Styles
├── js/
│   └── app.js                # Frontend-Logik, Charts
├── index.html                # Status-Page
├── minimaid.config.yml       # Zentrale Konfiguration
└── package.json
```

---

## Unterstützte Service-Typen

| Typ                | Beschreibung                      | Pflichtfelder               |
|--------------------|-----------------------------------|-----------------------------|
| `http` / `https`   | Website / API Health-Check        | `url`, opt. `expectedStatus`|
| `minecraft-java`   | Minecraft Java Edition Server     | `host`, opt. `port` (25565) |
| `minecraft-bedrock` | Minecraft Bedrock Edition Server | `host`, opt. `port` (19132) |
| `fivem`            | FiveM (GTA V) Server              | `host`, opt. `port` (30120) |

---

## Lokale Entwicklung

```bash
# Worker manuell ausführen
npm run check

# Seite lokal öffnen (z.B. mit npx serve)
npm run dev
# → http://localhost:3000
```

---

## Konfiguration

Alle Einstellungen in `minimaid.config.yml`:

```yaml
site:
  title: "Minimaid"
  description: "Mein Status Monitor"

theme:
  accent: "#ff2d95"       # Hauptfarbe
  success: "#39ff14"      # Online
  danger: "#ff073a"       # Offline

services:
  - id: "unique-id"
    name: "Anzeigename"
    type: "http"
    url: "https://..."

notifications:
  discord:
    enabled: true
    webhook_url: "${DISCORD_WEBHOOK_URL}"
    username: "Minimaid"

settings:
  check_timeout: 10000    # ms
  history_max_days: 90
```

---

## Lizenz

MIT
