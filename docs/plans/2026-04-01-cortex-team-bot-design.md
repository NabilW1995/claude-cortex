# Cortex Team Bot — Design Document

## Datum: 2026-04-01
## Status: Genehmigt

## Zusammenfassung

Ein Telegram-Bot der als Team-Koordinations-Tool für Claude Cortex Projekte dient. Zeigt offene Tasks, wer woran arbeitet, und benachrichtigt bei Reviews. GitHub Issues sind die Single Source of Truth, Telegram ist der Benachrichtigungs-Kanal.

## Architektur

```
Projekt A ──┐                              ┌── Telegram Gruppe A
Projekt B ──┼── Cloudflare Worker (zentral) ──┼── Telegram Gruppe B
Projekt C ──┘    ↕ GitHub API               └── Telegram Gruppe C
```

**Ein zentraler Cloudflare Worker bedient alle Projekte.** Jedes Projekt registriert sich mit seinem Bot-Token + GitHub-Repo beim Worker.

## Komponenten

### 1. Cloudflare Worker (zentral, einmal deployen)
- Empfängt GitHub Webhooks (Issues erstellt/geschlossen/assigned)
- Empfängt Telegram-Befehle (/tasks, /wer, /new, /assign, /done)
- Empfängt Session-Updates von Claude Hooks
- Speichert Projekt-Configs in Cloudflare KV Store

### 2. Cortex Template (in jedem Projekt)
- `scripts/bot/notify.js` — Sendet Session-Updates an den Worker
- `.env` — TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CORTEX_WORKER_URL
- `team.json` — User-Mapping (Telegram ↔ GitHub)
- Hooks: session-start.js erweitert → postet To-Dos in Telegram
- Hooks: session-end.js erweitert → postet Session-Summary

### 3. Setup-Skill (/setup-bot)
- Fragt Bot-Token + Chat-ID ab
- Registriert das Projekt beim zentralen Worker
- Richtet GitHub Webhook automatisch ein via gh CLI

## Telegram-Befehle

| Befehl | Funktion |
|--------|----------|
| /tasks | Alle offenen GitHub Issues anzeigen |
| /wer | Wer arbeitet gerade woran |
| /new <titel> | Neues GitHub Issue erstellen |
| /assign #5 @name | Issue zuweisen |
| /done #5 | Issue als erledigt markieren → Review-Ping |

## Telegram Topic-Struktur

Jedes Projekt bekommt ein eigenes Forum-Topic. Kein separates "General"-Topic.

```
Cortex (Telegram Gruppe)
├── Team Template    → Session-Updates + Tasks + Reviews
├── Cloud Cortex     → Session-Updates + Tasks + Reviews
└── [Neues Projekt]  → Wird automatisch erstellt bei /setup-bot
```

Alles zu einem Projekt (wer online ist, offene Tasks, erledigte Tasks) landet im jeweiligen Projekt-Topic.

## Automatische Nachrichten

Alle Nachrichten gehen ins jeweilige **Projekt-Topic** (via message_thread_id):

- **Session-Start:** To-Do-Liste + wer arbeitet woran
- **Session-Ende:** Was wurde erledigt, was ist noch offen
- **Issue geschlossen:** Review-Benachrichtigung an zugewiesene Person
- **Neues Issue:** Kurze Info im Projekt-Topic

## Session-Start Nachricht (Beispiel)

Im Topic "Team Template":
```
Nabil ist online -- arbeitet an Team Template

Offene Tasks (5):
- #12 Login-Seite bauen [Nabil]
- #13 API fuer Produkte [offen]
- #14 Warenkorb-Logik [offen]
- #15 Checkout-Flow [offen]
- #16 E-Mail-Bestaetigung [offen]

Aktuell in Arbeit:
- #12 Login-Seite bauen -> Nabil
```

## Getestete Telegram-Konfiguration

- **Bot:** @ClaudeCortexBot (Claude-CortexBOT)
- **Gruppe:** "Cortex" (Supergroup/Forum)
- **Chat-ID:** -1003891712197
- **Topic "Team Template":** message_thread_id = 9

## User-Mapping (team.json)

```json
{
  "members": [
    { "name": "Nabil", "github": "NabilW1995", "telegram": "@nabil_weikaemper" }
  ]
}
```

## Tech-Stack

- **Worker:** Cloudflare Workers (TypeScript)
- **Storage:** Cloudflare KV (Projekt-Configs, aktive Sessions)
- **APIs:** GitHub REST API (Issues), Telegram Bot API
- **Hooks:** Node.js Scripts (Teil von Cortex Template)
- **Setup:** Claude Skill (/setup-bot)

## Entscheidungen

1. **GitHub Issues statt eigene DB** — GitHub als zentrale Wahrheit, keine Sync-Probleme
2. **Ein zentraler Worker** — Einfacher zu warten als ein Worker pro Projekt
3. **Cloudflare Workers** — Kostenlos, serverless, perfekt für Webhook-basierte Bots
4. **Manuelle Config-Datei** — team.json für User-Mapping, einfach und transparent
5. **Telegram statt Slack** — Einfachere Bot-API, kein Workspace nötig
