---
description: Tech-Debt Landkarte — Hotspots finden, priorisieren, Payoff-Plan erstellen
argument-hint: "[Verzeichnis oder leer fuer ganzes Projekt]"
allowed-tools:
  - Read
  - Agent
  - Glob
  - Grep
  - Bash(git log:*, wc:*, date:*)
---

Scanne die Codebase nach technischen Schulden. Bewerte Dateien nach Komplexitaet,
Aenderungshaeufigkeit und bekannten Problemen. Erstelle einen priorisierten Abzahlungsplan.

## Schritte

### Schritt 1: Scope definieren

Wenn der User ein Verzeichnis angegeben hat, nutze das.
Sonst scanne das gesamte Projekt (ohne node_modules, .git, vendor, build).

### Schritt 2: Automatische Scans (parallele Agents)

Dispatche den Debt-Collector Agent plus parallele Scans:

**Agent 1 — TODO/FIXME/HACK Scan:**
- Suche nach TODO, FIXME, HACK, XXX, TEMP, WORKAROUND Kommentaren
- Fuer jeden: Datei, Zeile, Inhalt, Alter (git blame)
- Kategorisiere: Technische Schuld, fehlendes Feature, bekannter Bug, Cleanup

**Agent 2 — Komplexitaets-Hotspots:**
- Finde die groessten Dateien (nach Zeilenanzahl)
- Finde Dateien mit der tiefsten Verschachtelung (Proxy fuer Komplexitaet)
- Finde Dateien mit den meisten Funktionen/Methoden
- Meistgeaenderte Dateien: `git log --format='' --name-only | sort | uniq -c | sort -rn | head -20`
- Kreuzreferenz: Dateien die SOWOHL komplex ALS AUCH haeufig geaendert werden = Top-Prioritaet

**Agent 3 — Code-Gesundheits-Signale:**
- Pruefe auf deprecated API-Nutzung
- Finde ungenutzte Exports oder Dead-Code Patterns
- Pruefe Dependency-Gesundheit (veraltete Pakete)
- Suche nach dupliziertem Code (aehnliche Funktionssignaturen, Copy-Paste)

### Schritt 3: Jedes Debt-Item bewerten

Bewertung auf zwei Dimensionen:

**Impact (wie sehr es schadet):**
- 3 = Betrifft User, verursacht Bugs, blockiert Features
- 2 = Verlangsamt Entwicklung, macht Aenderungen riskant
- 1 = Code Smell, Lesbarkeits-Problem, Style-Thema

**Effort (wie schwer zu fixen):**
- 3 = Grosses Refactoring, mehrere Dateien, Breaking Changes
- 2 = Moderater Aufwand, auf einen Bereich beschraenkt
- 1 = Quick Fix, unter einer Stunde

**Prioritaet = Impact / Effort** — hoher Impact + niedriger Effort = zuerst fixen.

### Schritt 4: Debt-Map generieren

```markdown
# Tech-Debt Landkarte — [Projekt]

**Datum:** [datum]
**Dateien gescannt:** [anzahl]
**Debt-Items gefunden:** [anzahl]

## Zusammenfassung
- **Kritisch (jetzt fixen):** [anzahl]
- **Hoch (diesen Sprint):** [anzahl]
- **Mittel (einplanen):** [anzahl]
- **Niedrig (bei Gelegenheit):** [anzahl]

## Hotspots
Dateien mit der hoechsten Schulden-Konzentration:

| Datei | Debt-Items | Komplexitaet | Aenderungshaeufigkeit | Prioritaet |
|-------|-----------|--------------|----------------------|------------|
| [datei] | [anzahl] | [hoch/mittel/niedrig] | [commits/monat] | Kritisch |

## Debt-Inventar

### Kritische Prioritaet
1. **[datei:zeile]** — [beschreibung]
   - Impact: [3] / Effort: [1]
   - Empfehlung: [konkrete Aktion]

### Hohe Prioritaet
[items]

### Mittlere Prioritaet
[items]

## Abzahlungsplan

### Diese Woche
- [ ] [konkreter Fix mit Datei-Referenz]

### Diesen Monat
- [ ] [groesseres Refactoring]
- [ ] [Dependency-Updates]

### Backlog
- [ ] [Items fuer spaeter]

## Metriken zum Tracken
- TODO/FIXME Gesamtzahl (aktuell: [X])
- Veraltete Dependencies (aktuell: [X])

---
Fuehre diesen Command monatlich aus um Fortschritt zu messen.
```

Zeige die Zusammenfassung und die Top 3 Items die zuerst gefixt werden sollten.

## Wichtig
- MUST: Debt-Collector Agent dispatchen
- MUST: Erklaere jedes Item in einfacher Sprache
- MUST: Priorisiere nach Impact/Effort Verhaeltnis
- MUST: Konkrete Aktionen vorschlagen, nicht nur Probleme auflisten
