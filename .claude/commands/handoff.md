---
description: Strukturierte Session-Uebergabe — Kontext, Entscheidungen, naechste Schritte
argument-hint: "[an wen uebergeben wird]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash(git log:*, git status:*, git diff:*, date:*)
---

Erstelle ein strukturiertes Handoff-Briefing wenn Arbeit an eine andere Person
oder eine neue Session uebergeben wird. Erfasst Kontext, Entscheidungen, Risiken
und naechste Schritte damit nichts verloren geht.

## Schritte

### Schritt 1: Session-Kontext sammeln

Lies:
- `.claude/memory.md` — aktueller Stand
- Heutige Daily Note — Arbeitsprotokoll
- `git status` und `git log --oneline -10` — letzte Aenderungen

### Schritt 2: Erledigte Arbeit identifizieren

Aus dem Session-Kontext und Git-History auflisten:
- **Erledigt:** Tasks die in dieser Session abgeschlossen wurden
- **In Arbeit:** Angefangene aber nicht fertige Arbeit (mit aktuellem Stand)
- **Entscheidungen:** Getroffene Entscheidungen und ihre Begruendung
- **Geaenderte Dateien:** Jede modifizierte Datei mit einzeiliger Zusammenfassung

### Schritt 3: Offene Punkte identifizieren

- **Naechste Schritte:** Was als naechstes passieren sollte (sortiert)
- **Blockierte Items:** Tasks die nicht weiterkoennen und warum
- **Offene Fragen:** Entscheidungen die Input brauchen
- **Risiken:** Was schiefgehen koennte wenn nicht beachtet

### Schritt 4: Kontext fuer den Empfaenger

- **Projekt-Kontext:** Was ist dieses Projekt und was ist gerade wichtig?
- **Schluessel-Dateien:** Wo man die wichtigsten Dinge findet
- **Stolperfallen:** Nicht-offensichtliche Dinge die einen aufhalten
- **Abhaengigkeiten:** Externe Personen, Services oder Events

### Schritt 5: Handoff schreiben

Speichere unter `handoffs/handoff-[datum]-[uhrzeit].md`:

```markdown
# Session-Uebergabe

**Von:** [aktuelle Session]
**An:** [Empfaenger oder "Naechste Session"]
**Datum:** [Datum und Uhrzeit]

---

## Status-Zusammenfassung
[2-3 Saetze: Wo die Dinge gerade stehen]

## Was erledigt wurde
- [Erledigte Aufgabe mit Datei-Referenzen]

## Was in Arbeit ist
- **[Aufgabe]** — Stand: [wo es steht]. Naechste Aktion: [was zu tun ist]

## Getroffene Entscheidungen
| Entscheidung | Begruendung | Umkehrbar? |
|-------------|------------|------------|
| [entscheidung] | [warum] | Ja/Nein |

## Geaenderte Dateien
| Datei | Aenderung |
|-------|----------|
| [pfad] | [einzeilige Zusammenfassung] |

## Naechste Schritte (nach Prioritaet)
1. [Wichtigste naechste Aktion]
2. [Zweite Prioritaet]
3. [Dritte Prioritaet]

## Blockierte Items
- **[Item]** — Blockiert durch: [Grund]. Freigeben durch: [Aktion]

## Offene Fragen
- [Frage die beantwortet werden muss]

## Risiken
- [Risiko und was man dagegen tun kann]

## Stolperfallen
- [Nicht-offensichtliche Sache die einen aufhaelt]

---
Uebergabe abgeschlossen. Lies dies bevor du anfaengst zu arbeiten.
```

Zeige die Status-Zusammenfassung damit der User pruefen kann ob sie stimmt.

## Wichtig
- MUST: Einfache Sprache — der Empfaenger ist vielleicht kein Programmierer
- MUST: Konkrete Datei-Referenzen bei allen Aufgaben
- MUST: Entscheidungen MIT Begruendung dokumentieren
- MUST: Risiken und Stolperfallen explizit benennen
