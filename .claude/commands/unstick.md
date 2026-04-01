---
description: Wenn du feststeckst — schnell wieder in den Flow kommen
argument-hint: "[was nicht funktioniert]"
allowed-tools:
  - Read
  - Agent
  - Grep
  - Glob
  - WebSearch
  - Bash(python3:*, python:*, git log:*)
---

Durchbruch bei einem Block. Nutzt den Unsticker-Agent fuer Root-Cause-Analyse
und frische Loesungsansaetze.

## Schritte

### Schritt 1: Block-Zustand erfassen

Wenn der User beschrieben hat woran er feststeckt, nutze das direkt.
Sonst automatisch ableiten aus:
- `.claude/memory.md` → aktuelle Aufgabe
- Heutige Daily Note → letzte Eintraege
- Letzten Tool-Calls im Kontext → was wurde versucht?

Formuliere den Block in einem Satz: "Ich stecke fest bei [X] weil [Y]."

### Schritt 2: Block klassifizieren

| Typ | Signale | Ansatz |
|-----|---------|--------|
| **Wissenslücke** | "Ich weiss nicht wie..." | Doku suchen, Source lesen, Knowledge-Base pruefen |
| **Entscheidungsparalyse** | "Ich kann mich nicht entscheiden..." | Tradeoffs auflisten, reversible Option waehlen |
| **Kreis-Debugging** | Gleicher Fehler 3+ Mal | Zuruecktreten, Problem neu formulieren, Gegenansatz |
| **Scope-Verwirrung** | "Das ist groesser als gedacht" | Yak-Shave Check — loesen wir das richtige Problem? |
| **Umgebungsproblem** | Build/Deploy/Config Fehler | Logs pruefen, Voraussetzungen verifizieren |

### Schritt 3: SQLite DB nach bekannten Loesungen durchsuchen

```python
import sqlite3
conn = sqlite3.connect(r'C:\Users\Nabil\.claude-learnings\learnings.db')
c = conn.cursor()
c.execute("""SELECT rule, correction, confidence FROM learnings
             WHERE learnings MATCH ? ORDER BY rank LIMIT 5""",
          ['relevante Suchbegriffe'])
```

Pruefe ob dieses Problem schon mal geloest wurde.

### Schritt 4: Unsticker-Agent dispatchen

Dispatche den Unsticker-Agent als Subagent:
```
Agent(unsticker): Ich stecke fest bei [Problem].

Was versucht wurde: [Liste der Versuche]
Fehler/Symptom: [was passiert]
Erwartet: [was passieren sollte]

Analysiere und schlage Loesungen vor.
```

### Schritt 5: Eskalations-Kette beachten

Falls der User wiederholt korrigiert:
- 3 Korrekturen → Rubber-Duck Agent dispatchen (Sokratisches Debugging)
- 5 Korrekturen → Unsticker Agent mit vollem Kontext
- Wenn Unsticker nach 2 Runden keine Loesung: Web-Suche einsetzen

### Schritt 6: Loesung umsetzen

Nimm die Top-Empfehlung des Unstickers und setze sie sofort um.
Nicht lang ueberlegen — handeln. Der schnellste Weg raus ist durch.

### Schritt 7: Loesung dokumentieren

Wenn geloest, in der Daily Note eintragen:
```markdown
### Unstick — [Uhrzeit]
- **Block:** [was feststeckte]
- **Ursache:** [warum]
- **Loesung:** [was funktioniert hat]
```

Wenn die Loesung ein Pattern zeigt → als Learning in die SQLite DB speichern
und zur Knowledge-Nomination vorschlagen.

## Wichtig
- MUST: Einfache Sprache fuer Problem und Loesung
- MUST: Keine technischen Details die der User nicht braucht
- MUST: Optionen sortiert nach: Schnellste Loesung zuerst
- MUST: Web-Suche nutzen wenn lokales Wissen nicht reicht
