---
description: Sprint-Retrospektive — Was lief gut, was nicht, was aendern
argument-hint: "[Zeitraum oder leer fuer diese Woche]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Agent
  - Bash(date:*, python3:*, python:*)
---

Retrospektive-Analyse. Reviewe einen Zeitraum, extrahiere Patterns, verbessere das System.

## Schritte

### Schritt 1: Scope bestimmen

Wenn der User einen Zeitraum angegeben hat, nutze diesen.
Sonst Standard: "diese Woche".

### Schritt 2: Daten sammeln (parallele Reads)

Lies gleichzeitig:
- Letzte Daily Notes (5-7 Tage)
- `.claude/knowledge-nominations.md` — offene Learnings
- `.claude/knowledge-base.md` — aktuelle Regeln
- `.claude/memory.md` — aktiver Kontext

Zusaetzlich aus der SQLite DB:
```python
import sqlite3
conn = sqlite3.connect(r'C:\Users\Nabil\.claude-learnings\learnings.db')
c = conn.cursor()
c.execute("""SELECT category, rule, confidence, created_at FROM learnings
             WHERE created_at > date('now', '-7 days') ORDER BY created_at DESC""")
```

### Schritt 3: Patterns analysieren

**Was lief gut?**
- Tasks die reibungslos erledigt wurden
- Workflows ohne Blockaden
- Learnings die erfolgreich erfasst wurden
- Positive Trends in der Qualitaet

**Was lief nicht gut?**
- Wiederholte Fehler (gleicher Fehlertyp mehrfach)
- Tasks die viel laenger dauerten als erwartet
- Haeufige Kontext-Flushes (/safe-clear) noetig
- Korrekturen die haetten vermieden werden koennen
- Blocker die zu lange bestanden

**Was aendern?**
- Gibt es Prozess-Engpaesse?
- Fehlen Agents oder Commands fuer wiederkehrende Aufgaben?
- Sind Regeln in der Knowledge-Base veraltet?
- Gibt es Muster die als neue Regeln gespeichert werden sollten?

### Schritt 4: Verbesserungen extrahieren

Fuer jede identifizierte Verbesserung:
1. Ist es eine **Knowledge-Base Regel**? → Direkt promoten
2. Ist es eine **Prozess-Aenderung**? → Dem User zur Pruefung vorlegen
3. Ist es eine **Tool/Config Aenderung**? → Als Aufgabe notieren
4. Ist es ein **Pattern zum Beobachten**? → Zu knowledge-nominations nominieren

### Schritt 5: Retro-Bericht schreiben

In die Daily Note eintragen:

```markdown
## Retrospektive — [Zeitraum]

### Was lief gut
- [Punkte]

### Was lief nicht gut
- [Punkte]

### Aktions-Items
- [ ] [Konkrete Verbesserung]

### Metriken
- Tasks erledigt: [X]
- Learnings erstellt: [X]
- Blocker: [X]
- Kontext-Flushes: [X]
```

### Schritt 6: Verbesserungen umsetzen

- Knowledge-Base Regeln direkt hinzufuegen (mit User-Erlaubnis)
- Nominations erstellen fuer unsichere Patterns
- Dem User die Top 3 Verbesserungsvorschlaege praesentieren

## Wichtig
- MUST: Einfache Sprache — keine technischen Metriken ohne Erklaerung
- MUST: Immer auch Positives hervorheben — nicht nur Kritik
- MUST: Konkrete Aktions-Items mit klaren naechsten Schritten
- MUST: Learnings aus der Retro in die SQLite DB speichern
- MUST: User fragen bevor Knowledge-Base Regeln geaendert werden
