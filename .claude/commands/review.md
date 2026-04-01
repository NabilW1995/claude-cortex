---
description: Tiefes Code-Review — Sicherheit, Performance, Architektur mit parallelen Agents
argument-hint: "[Datei, Verzeichnis oder Branch]"
allowed-tools:
  - Read
  - Agent
  - Glob
  - Grep
  - Bash(git diff:*, git log:*, git show:*)
---

Umfassendes Code-Review. Geht ueber Style hinaus — prueft Sicherheit, Performance,
Architektur und generiert konkrete Verbesserungsvorschlaege.

## Schritte

### Schritt 1: Scope bestimmen

Identifiziere was reviewed werden soll:
- User hat eine Datei oder Verzeichnis angegeben → das reviewen
- User hat einen Branch angegeben → `git diff main...HEAD`
- Nichts angegeben → staged Changes (`git diff --cached`) oder letzte Commits

### Schritt 2: Code lesen

Lies alle Dateien im Scope. Bei grossen Diffs fokussiere auf:
- Neue Dateien (hoechstes Risiko — noch nie reviewed)
- Dateien mit den meisten Aenderungen
- Test-Dateien (oder deren Fehlen)

### Schritt 3: Multi-Dimensionales Review (parallele Agents)

Dispatche parallele Review-Agents als Subagents:

**Agent 1 — Sicherheits-Review:**
- Input-Validierung (SQL Injection, XSS, Command Injection)
- Authentifizierungs- / Autorisierungs-Luecken
- Secrets oder Credentials im Code
- Unsichere Dependencies
- OWASP Top 10 Checkliste
- Referenz: `.claude/rules/security.md` und `.claude/rules/input-sanitization.md`

**Agent 2 — Performance-Review:**
- N+1 Queries oder unnoetige Datenbank-Aufrufe
- Fehlende Indizes (wenn Schema sichtbar)
- Unbegrenzte Schleifen oder Rekursion
- Grosse Speicher-Allokationen
- Fehlende Caching-Moeglichkeiten
- Unnoetige Re-Renders (React) oder Neuberechnungen

**Agent 3 — Architektur-Review:**
- Folgt der Code bestehenden Patterns der Codebase?
- Ist die Verantwortung klar getrennt?
- Gibt es zirkulaere Abhaengigkeiten?
- Ist das Abstraktionslevel angemessen? (over-engineered oder under-abstracted)
- Wird es einfach zu testen, debuggen und warten sein?

### Schritt 4: Findings kompilieren

Jedes Finding kategorisieren:

| Schweregrad | Bedeutung |
|-------------|-----------|
| **CRITICAL** | Muss vor Merge gefixt werden — Sicherheitsluecke, Datenverlust-Risiko |
| **HIGH** | Sollte gefixt werden — Performance-Problem, Architektur-Bedenken |
| **MEDIUM** | Sollte man fixen — Code Smell, kleine Ineffizienz, Lesbarkeit |
| **LOW** | Nit — Style-Praeferenz, Namensvorschlag, Kommentar-Verbesserung |

### Schritt 5: Review-Bericht generieren

Strukturierter Output:

```markdown
## Code Review — [Scope]

### Zusammenfassung
[1-2 Saetze: Gesamtbewertung und Top-Bedenken]

### Kritische Probleme
- **[Datei:Zeile]** — [Problem und warum es wichtig ist]
  **Fix:** [konkreter Code-Vorschlag]

### Hohe Prioritaet
- **[Datei:Zeile]** — [Problem]
  **Fix:** [Vorschlag]

### Mittlere Prioritaet
- [Aufzaehlung]

### Was gut ist
- [Konkrete Dinge die gut gemacht wurden — immer Positives erwaehnen]

### Verdict
[GENEHMIGT / GENEHMIGT MIT AENDERUNGEN / AENDERUNGEN NOETIG]
[Ein Satz Begruendung]
```

### Schritt 6: Auto-Fix anbieten

Frage den User: "Soll ich die kritischen und hohen Probleme jetzt fixen?"

Bei Ja: Fixes direkt anwenden und Tests laufen lassen.
Bei Nein: Review steht als Dokumentation.

## Wichtig
- MUST: Erklaere Findings in einfacher Sprache
- MUST: Immer auch Positives erwaehnen — nicht nur Kritik
- MUST: Konkrete Fix-Vorschlaege mit Code-Referenzen
- MUST: Referenziere unsere Sicherheitsregeln aus `.claude/rules/`
- MUST: Review als Subagent dispatchen (frische Augen = bessere Qualitaet)
