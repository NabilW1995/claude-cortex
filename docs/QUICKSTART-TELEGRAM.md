# Telegram Team Bot — Quickstart

## Was ist das?

Der Cortex Team Bot verbindet dein Projekt mit einer Telegram-Gruppe. Jedes Mal wenn jemand eine Claude-Session startet, sieht das ganze Team:
- Wer gerade online ist und an welchem Projekt arbeitet
- Welche Tasks (GitHub Issues) offen sind
- Was in der letzten Session erledigt wurde

Jedes Projekt hat seinen eigenen Bot. Alle Bots posten in die gleiche Telegram-Gruppe.

## Telegram-Gruppe (einmalig)

Die zentrale Gruppe hat diese Struktur:

```
Cortex Team (Telegram Gruppe mit Forum/Topics)
├── Login              → Wer geht online, in welchem Projekt
├── Projekt A          → Tasks + Updates fuer Projekt A
├── Projekt B          → Tasks + Updates fuer Projekt B
└── ...
```

**Login-Topic Thread-ID:** 32 (fest, fuer alle Projekte gleich)

## Neues Projekt einrichten

### Schritt 1: Bot erstellen (2 Minuten)

1. Oeffne Telegram, such nach **@BotFather**
2. Schreib `/newbot`
3. Gib einen Namen ein (z.B. `Passcraft Bot`)
4. Gib einen Username ein (z.B. `passcraft_cortex_bot` — muss auf `_bot` enden)
5. Kopiere den **Token**

### Schritt 2: Bot zur Gruppe hinzufuegen

1. Oeffne die Cortex Team Gruppe in Telegram
2. Fuege den neuen Bot als **Admin** hinzu (braucht: Topics verwalten + Nachrichten senden)
3. Schalt **Group Privacy** aus: @BotFather → `/mybots` → Bot waehlen → Bot Settings → Group Privacy → Turn OFF

### Schritt 3: Projekt-Topic erstellen

Der Bot erstellt automatisch ein Topic wenn er das erste Mal laeuft. Oder manuell:
- In der Gruppe: Neues Topic erstellen mit dem Projektnamen
- Thread-ID notieren (steht in der URL oder frag den Bot)

### Schritt 4: .env konfigurieren

In deinem Projekt-Ordner, fuege zu `.env` hinzu:

```env
TELEGRAM_BOT_TOKEN=dein-bot-token-hier
TELEGRAM_CHAT_ID=-1003891712197
TELEGRAM_THREAD_ID=34                  # Dein Projekt-Topic
TELEGRAM_LOGIN_THREAD_ID=32            # Login-Topic (immer 32)
```

### Schritt 5: Beim Worker registrieren

```bash
node -e "
const https = require('https');
const data = JSON.stringify({
  projectId: 'dein-projekt-name',
  botToken: 'DEIN_BOT_TOKEN',
  chatId: '-1003891712197',
  threadId: DEINE_THREAD_ID,
  loginThreadId: 32,
  githubRepo: 'username/repo-name',
  githubToken: 'ghp_...'
});
const req = https.request('https://cortex-team-bot.twilight-resonance-f2fc.workers.dev/register', {
  method: 'POST',
  headers: {'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}
}, res => { let b=''; res.on('data', c => b+=c); res.on('end', () => console.log(b)); });
req.write(data); req.end();
"
```

### Schritt 6: Telegram Webhook setzen

```bash
node -e "
const https = require('https');
https.get('https://api.telegram.org/botDEIN_BOT_TOKEN/setWebhook?url=https://cortex-team-bot.twilight-resonance-f2fc.workers.dev/telegram/dein-projekt-name', res => {
  let d=''; res.on('data', c => d+=c); res.on('end', () => console.log(d));
});
"
```

### Schritt 7: Testen

```bash
CLAUDE_PROJECT_DIR="." node scripts/bot/notify.js session-start
```

Du solltest zwei Nachrichten in Telegram sehen:
- Login-Topic: "Dein Name ist online -- arbeitet an Projektname"
- Projekt-Topic: Offene Tasks

## Team-Mitglieder registrieren

Jedes Team-Mitglied muss sich **einmalig** registrieren. Danach ist es in allen Projekten bekannt.

**Option A: In Telegram**
Schreib in irgendeinem Projekt-Topic:
```
/register dein-github-username
```

**Option B: Via API**
```bash
node -e "
const https = require('https');
const data = JSON.stringify({
  telegram_id: 123456789,
  telegram_username: 'dein_telegram_name',
  github: 'dein-github-username',
  name: 'Dein Name'
});
const req = https.request('https://cortex-team-bot.twilight-resonance-f2fc.workers.dev/register-member', {
  method: 'POST',
  headers: {'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}
}, res => { let b=''; res.on('data', c => b+=c); res.on('end', () => console.log(b)); });
req.write(data); req.end();
"
```

## Telegram-Befehle

| Befehl | Was passiert |
|--------|-------------|
| `/tasks` | Zeigt offene GitHub Issues |
| `/wer` | Zeigt wer gerade an welchem Projekt arbeitet |
| `/new Fix Login Bug` | Erstellt ein neues GitHub Issue |
| `/done #5` | Schliesst Issue #5 + postet "Ready for Review" |
| `/register NabilW1995` | Verknuepft deinen Telegram-Account mit GitHub |

## Automatische Nachrichten

Diese werden automatisch durch Claude-Hooks gesendet:

| Wann | Login-Topic | Projekt-Topic |
|------|-------------|---------------|
| Session-Start | "Nabil ist online -- arbeitet an Passcraft" | Offene Tasks + wer arbeitet woran |
| Session-Ende | "Nabil hat Session beendet" | Prompts, Korrekturen, letzte Commits |

## Architektur

```
Projekt A (Bot A) ──┐
Projekt B (Bot B) ──┼── Cloudflare Worker (zentral) ── Telegram Gruppe
Projekt C (Bot C) ──┘       ↕ GitHub API                  ├── Login
                            ↕ KV Store                    ├── Projekt A
                         (Team Registry)                   ├── Projekt B
                                                           └── Projekt C
```

- **Cloudflare Worker:** `https://cortex-team-bot.twilight-resonance-f2fc.workers.dev`
- **KV Store:** Speichert Projekt-Configs + zentrale Team-Registry
- **Telegram Chat-ID:** `-1003891712197`

## Fehlerbehebung

**Bot antwortet nicht auf Befehle:**
→ Group Privacy ausschalten: @BotFather → `/mybots` → Bot Settings → Group Privacy → Turn OFF

**"Kein GitHub-Token konfiguriert":**
→ Projekt nochmal beim Worker registrieren mit `githubToken`

**"message thread not found":**
→ TELEGRAM_THREAD_ID in .env pruefen — stimmt die Topic-ID?

**Session-Start postet nicht:**
→ `.env` vorhanden? Alle 4 TELEGRAM_* Variablen gesetzt?
