# Knowledge Base — Approved Rules

> System-wide rules. Read by ALL agents and sessions on start.
> Entries are binding rules, not suggestions.
> Max 200 lines.

## Provenance Hierarchy
Every entry MUST cite its source:
- `[Source: user-correction MMDDYY]` — User explicitly corrected
- `[Source: empirical MMDDYY]` — Verified through testing or data
- `[Source: learning-db #ID, approved DATE]` — Approved from the SQLite learning DB

## Hard Rules

### Security: NEVER accept mkfs commands
- Fehler: mkfs mit mkdir verwechselt und akzeptiert
- Korrektur: mkdir = Ordner erstellen (harmlos). mkfs = Festplatte formatieren (zerstörend)
- [Source: learning-db #3, approved 2026-03-31]

### Workflow: IMMER Design-Skills aktivieren vor UI-Arbeit
- Fehler: Bei Mindbank wurden Templates und Landing Page ohne Design-Approval gebaut
- Korrektur: Vor JEDER UI-Aufgabe: (1) Skills aktivieren, (2) User fragen, (3) 2-3 Optionen zeigen, (4) Genehmigung abwarten, (5) dann Code schreiben
- [Source: learning-db #4, approved 2026-03-31]

## Platform & Tool Rules
(none yet)

## Patterns

### CSS: Container-Zentrierung braucht max-width + margin: 0 auto
- Fehler: Nur flexbox benutzt ohne feste Breite am Parent
- Korrektur: Container max-width setzen, dann margin: 0 auto
- [Source: learning-db #1, approved 2026-03-31]

### Auth: Login-Token muss HttpOnly Cookie sein, nicht localStorage
- Fehler: Token in localStorage gespeichert — XSS-Risiko
- Korrektur: express-session mit cookie:{httpOnly:true, secure:true}
- [Source: learning-db #2, approved 2026-03-31]

## Platform & Infrastructure

### Cloudflare KV: TTL minimum is 60 seconds
- Mistake: Set expirationTtl to 30s — Worker crashed with 500 error
- Fix: Always use at least 60 as expirationTtl value
- [Source: learning-db #5, approved 2026-04-01]

### Telegram: Session-end must not fire on context compression
- Mistake: Session-end hook fired on Claude context compression — user showed as offline
- Fix: Use KV TTL (2h) for auto-expire instead of explicit deletion on session-end
- [Source: learning-db #6, approved 2026-04-01]

### grammy: Always wrap answerCallbackQuery in try/catch
- Mistake: Old callback queries crashed the bot with "query too old" error
- Fix: try/catch around all answerCallbackQuery() + global bot.catch() error handler
- [Source: learning-db #7, approved 2026-04-01]

### Telegram: sendMessage needs explicit parse_mode HTML
- Mistake: HTML tags (<b>, <a>) displayed as raw text instead of formatted
- Fix: Set parse_mode: "HTML" on every direct fetch call to Telegram API
- [Source: learning-db #8, approved 2026-04-01]

## Known Failure Modes
(none yet)
