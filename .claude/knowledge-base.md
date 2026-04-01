# Knowledge Base — Bestätigte Regeln

> System-weite Regeln. Werden von ALLEN Agents und Sessions beim Start gelesen.
> Geschrieben NUR vom Auditor nach Bestätigung von Learnings.
> Einträge sind verbindliche Regeln, keine Vorschläge.
> Max 200 Zeilen.

## Provenance Hierarchy
Jeder Eintrag MUSS seine Quelle zitieren:
- `[Source: user-korrektur MMDDYY]` — User hat explizit korrigiert
- `[Source: empirisch MMDDYY]` — Durch Testen oder Daten verifiziert
- `[Source: agent-beobachtung MMDDYY]` — Pattern von einem Agent erkannt, vom Auditor bestätigt
- `[Source: learning-db #ID, approved DATE]` — Aus der SQLite Learning-DB genehmigt

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

## Known Failure Modes
(none yet)
