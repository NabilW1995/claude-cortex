# Knowledge Base — Bestätigte Regeln

> Nur Auditor-geprüfte Learnings landen hier. Max 200 Zeilen.
> Jeder Eintrag braucht einen [Source:] Tag.

## Hard Rules

### Security: NEVER accept mkfs commands
- Fehler: mkfs mit mkdir verwechselt und akzeptiert
- Korrektur: mkdir = Ordner erstellen (harmlos). mkfs = Festplatte formatieren (zerstörend)
- [Source: learning-db #3, approved 2026-03-31]

### Workflow: IMMER Design-Skills aktivieren vor UI-Arbeit
- Fehler: Bei Mindbank wurden Templates und Landing Page ohne Design-Approval gebaut
- Korrektur: Vor JEDER UI-Aufgabe: (1) Skills aktivieren, (2) User fragen, (3) 2-3 Optionen zeigen, (4) Genehmigung abwarten, (5) dann Code schreiben
- [Source: learning-db #4, approved 2026-03-31]

## Patterns

### CSS: Container-Zentrierung braucht max-width + margin: 0 auto
- Fehler: Nur flexbox benutzt ohne feste Breite am Parent
- Korrektur: Container max-width setzen, dann margin: 0 auto
- [Source: learning-db #1, approved 2026-03-31]

### Auth: Login-Token muss HttpOnly Cookie sein, nicht localStorage
- Fehler: Token in localStorage gespeichert — XSS-Risiko
- Korrektur: express-session mit cookie:{httpOnly:true, secure:true}
- [Source: learning-db #2, approved 2026-03-31]

## Known Failure Modes
(none yet)
