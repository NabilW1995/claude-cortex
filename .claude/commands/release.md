---
description: Release Notes generieren — technisch, Marketing und Executive aus Git-History
argument-hint: "[Version oder Datums-Bereich]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash(git log:*, git tag:*, git diff:*, date:*)
---

Generiere Release Notes automatisch aus der Git-History. Erstellt zielgruppen-gerechte
Versionen — technischer Changelog, Marketing-Ankuendigung und Executive Summary.

## Schritte

### Schritt 1: Bereich bestimmen

Finde heraus welche Commits einbezogen werden:
- User hat Version angegeben → Tag-Range finden (z.B. `git log v1.2.0..v1.3.0`)
- User hat Datumsbereich angegeben → `git log --after="..." --before="..."`
- Nichts angegeben → Aenderungen seit letztem Tag: `git log $(git describe --tags --abbrev=0)..HEAD`
- Kein Tag vorhanden → letzte 20 Commits

### Schritt 2: Commit-Daten sammeln

```bash
git log [range] --format="%h %s" --no-merges
```

Zusaetzlich pruefen:
- PR-Beschreibungen (aus Merge-Commit Messages)
- CHANGELOG Eintraege (falls vorhanden)
- Geaenderte Dateien fuer Scope: `git diff --stat [range]`

### Schritt 3: Aenderungen kategorisieren

Jede Aenderung einsortieren:

| Kategorie | Beschreibung | Beispiel |
|-----------|-------------|---------|
| **Neue Features** | Neue Faehigkeit, neuer Endpoint | feat: Commits |
| **Verbesserungen** | Performance, UX, Refactoring | refactor/perf: Commits |
| **Bug Fixes** | Behobene Fehler | fix: Commits |
| **Breaking Changes** | API-Aenderung, entferntes Feature | BREAKING in Message |
| **Dependencies** | Aktualisierte Pakete | chore(deps): Commits |
| **Intern** | Tests, CI, Docs | test/docs/ci: Commits |

### Schritt 4: Release Notes schreiben (3 Versionen)

**Version 1 — Technischer Changelog** (fuer Entwickler):
```markdown
# [Version] — [Datum]

## Breaking Changes
- [Aenderung mit Migrations-Anleitung]

## Neue Features
- [Feature]: [Beschreibung] ([Commit-Hash])

## Verbesserungen
- [Verbesserung] ([Commit-Hash])

## Bug Fixes
- [Fix] ([Commit-Hash])

## Dependencies
- [Paket] von [alt] auf [neu] aktualisiert
```

**Version 2 — Marketing-Ankuendigung** (fuer Kunden/Oeffentlichkeit):
```markdown
# Was ist neu in [Version]

[1-2 Saetze Hook — die aufregendste Aenderung]

### [Feature-Name]
[Nutzen-fokussierte Beschreibung — was es fuer den User bedeutet]

### [Verbesserung]
[User-sichtbare Verbesserung mit Vorher/Nachher]

### Bug Fixes
[Zusammenfassung — "X Probleme behoben darunter..." — keine Commit-Hashes]
```

**Version 3 — Executive Summary** (fuer Stakeholder):
```markdown
# Release-Zusammenfassung — [Version]

**Auswirkung:** [Ein Satz — was dieses Release bewirkt]

**Wichtigste Aenderungen:**
- [Top 3 Aenderungen, Business-Impact Framing]

**Metriken:**
- [X] Features hinzugefuegt
- [X] Bugs behoben
- [X] Dateien geaendert

**Risiko:** [Breaking Changes oder Migrations-Bedarf — oder "Keines"]
```

### Schritt 5: Speichern und ausgeben

Speichere unter `releases/[version]-release-notes.md` mit allen drei Versionen.

Zeige die Marketing-Version als Standard (am haeufigsten gebraucht) und erwaehne
dass die anderen Versionen in der Datei zu finden sind.

## Wichtig
- MUST: Alle drei Versionen generieren
- MUST: Breaking Changes deutlich hervorheben
- MUST: Marketing-Version in einfacher Sprache (keine Commit-Hashes)
- MUST: Executive Summary auf Business-Impact fokussieren
