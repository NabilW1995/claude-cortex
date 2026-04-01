---
description: Tagesende — Learnings sichern, Memory aufraumen, morgen vorbereiten
argument-hint: ""
allowed-tools:
  - Read
  - Write
  - Edit
  - Agent
  - Bash(date:*, git:*, python3:*, python:*)
---

Tagesende-Ritual. Wissen externalisieren, aufraeumen, morgen vorbereiten.

## Schritte

### Schritt 1: Aktuellen Stand lesen (parallel)

Lies gleichzeitig:
- `.claude/memory.md`
- Heutige Daily Note aus `daily-notes/`
- `.claude/knowledge-nominations.md`
- `.claude/knowledge-base.md`

### Schritt 2: Learning-Externalisierung

Pruefe die heutige Arbeit auf Learnings:
- **User-Korrekturen:** Hat der User etwas explizit korrigiert? → Learning extrahieren
- **Empirische Entdeckungen:** Dinge die durch Tests bewiesen wurden → Learning extrahieren
- **Pattern-Beobachtungen:** Wiederkehrende Muster bemerkt → Learning extrahieren
- **Fehler-Lektionen:** Root-Cause von geloesten Fehlern → Learning extrahieren

Fuer jedes Learning: In die SQLite DB speichern (zweisprachig DE+EN):
```python
import sqlite3
from datetime import datetime
conn = sqlite3.connect(r'C:\Users\Nabil\.claude-learnings\learnings.db')
c = conn.cursor()
c.execute("""INSERT INTO learnings (project, category, rule, rule_en, mistake, mistake_en,
             correction, correction_en, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
          [project, category, rule, rule_en, mistake, mistake_en, correction, correction_en, 0.8])
learning_id = c.lastrowid
c.execute("INSERT INTO nominations (learning_id, status) VALUES (?, 'pending')", [learning_id])
conn.commit()
```

MUST: Dem User zeigen was genau gespeichert wird und sofort fragen:
"Soll das eine feste Regel werden?"

### Schritt 3: Memory aufraumen

Aktualisiere `.claude/memory.md`:
- "Now" Sektion mit aktuellem Stand aktualisieren
- Erledigte Threads aufloesen
- Veraltete Entscheidungen entfernen (aelter als 1 Woche)
- Geloeste Blocker entfernen
- Stale Eintraege die nicht mehr relevant sind — loeschen

### Schritt 4: Knowledge-Nomination Review

Pruefe offene Nominations — kurzer Check:
- Gibt es Nominations die laenger als 3 Tage offen sind?
- Empfehle `/audit` falls mehr als 5 offene Nominations existieren
- Bei 1-2 offenen: Direkt hier reviewen (wie in /audit Schritt 4-5)

### Schritt 5: Daily Note finalisieren

Ergaenze die heutige Daily Note:
```markdown
## Tagesende-Zusammenfassung
### Erledigt
- [Was heute gemacht wurde]

### Offen
- [Was noch nicht fertig ist]

### Entscheidungen
- [Entscheidungen und Begruendung]

### Naechste Schritte
- [Was morgen als erstes passieren sollte]
```

### Schritt 6: Checkpoint-Commit

Pruefe ob es uncommittete Aenderungen gibt:
```bash
git status --short
```

Wenn Aenderungen vorhanden:
- Zeige dem User was sich geaendert hat
- Frage: "Soll ich einen Checkpoint-Commit erstellen?"
- Bei Ja: Commit mit Message `chore: checkpoint [Datum] — [kurze Beschreibung]`

### Schritt 7: Vorschau auf morgen

Basierend auf offenen Tasks und Threads, schlage 1-3 Prioritaeten fuer morgen vor.

### Schritt 8: Team-Learnings Sync

Pruefe ob neue Learnings in der DB sind die noch nicht gepusht wurden:
- Wenn neue approved Learnings: Hinweis "Neue Team-Learnings verfuegbar"
- Empfehle `git push` um sie dem Team zugaenglich zu machen
- Pushe NICHT automatisch — nur Empfehlung

### Schritt 9: Verabschiedung

Kurze Nachricht:
- Was heute erreicht wurde (2-3 Saetze)
- Was morgen als erstes dran ist
- Eventuelle Blocker die ueber Nacht geklaert werden sollten

## Wichtig
- MUST: Einfache Sprache
- MUST: Learnings dem User zeigen bevor sie gespeichert werden
- MUST: Checkpoint-Commit nur mit User-Erlaubnis
- MUST: NIEMALS automatisch pushen
- MUST: Veraltete Memory-Eintraege aktiv entfernen
