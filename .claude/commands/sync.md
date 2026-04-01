---
description: Mid-Session Sync — Kontext auffrischen, Memory aktualisieren, Kurs pruefen
argument-hint: ""
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash(date:*, python3:*, python:*)
---

Kontext-Refresh mitten in der Session. Memory aktualisieren, Fortschritt pruefen,
Orientierung behalten.

## Schritte

### Schritt 1: Aktuellen Stand lesen (parallel)

Lies gleichzeitig:
- `.claude/memory.md` — aktiver Kontext
- Heutige Daily Note aus `daily-notes/`
- `.claude/knowledge-nominations.md` — offene Nominations

### Schritt 2: Kontext-Gesundheitscheck

Selbstbewertung:
- Bin ich noch am richtigen Problem dran?
- Drehe ich mich bei irgendwas im Kreis?
- Wird mein Kontext schwer? (Wenn ja, `/safe-clear` empfehlen)
- Habe ich seit dem Start das Thema gewechselt?

### Schritt 3: Orientierungs-Check (Boyd's Law)

Frage dich:
- Was hat sich seit heute Morgen / seit dem Start geaendert?
- Welche Annahmen mache ich, die falsch sein koennten?
- Was ist die einfachste naechste Aktion?
- Bin ich noch auf dem Weg zum urspruenglichen Ziel?

### Schritt 4: Learning-Nominations pruefen

Pruefe in der SQLite DB ob es neue Nominations gibt:
```python
import sqlite3
conn = sqlite3.connect(r'C:\Users\Nabil\.claude-learnings\learnings.db')
c = conn.cursor()
c.execute("SELECT COUNT(*) FROM nominations WHERE status = 'pending'")
```

Wenn Nominations offen: Kurz erwaehnen, fuer `/audit` empfehlen.

### Schritt 5: Fortschritt zusammenfassen

Erstelle eine kurze Fortschritts-Uebersicht:
- Was wurde seit dem Start / letzten Sync erledigt?
- Was ist noch offen?
- Gibt es neue Blocker?
- Hat sich die Prioritaet geaendert?

### Schritt 6: Memory aktualisieren

Aktualisiere `.claude/memory.md`:
- "Now" Sektion mit aktuellem Fokus updaten
- Offene Threads hinzufuegen/aufloesen
- Neue Entscheidungen eintragen
- Blocker aktualisieren
- Veraltete Eintraege entfernen

### Schritt 7: Daily Note ergaenzen

Ergaenze die heutige Daily Note mit:
- Fortschritt seit dem letzten Eintrag
- Entscheidungen die getroffen wurden
- Wichtige Notizen

### Schritt 8: Status-Bericht

Kurze Zusammenfassung fuer den User:
- Was wurde heute Morgen / bisher erledigt
- Aktueller Fokus
- Blocker oder Prioritaetsaenderungen
- Empfohlene naechste Aktion
- Anzahl offener Nominations (falls vorhanden)

## Wann nutzen
- Nach 3-4 Stunden Arbeit
- Wenn das Thema gewechselt wird
- Wenn der Kontext "voll" anfuehlt
- Vor groesseren Richtungswechseln

## Wichtig
- MUST: Einfache Sprache
- MUST: Halte den Status-Bericht unter 10 Zeilen
- MUST: Frage ob die Richtung noch stimmt
- MUST: Empfehle `/safe-clear` wenn der Kontext schwer wird
