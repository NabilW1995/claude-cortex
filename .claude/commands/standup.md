---
description: Taegliches Standup in 30 Sekunden — Gestern, Heute, Blocker
argument-hint: ""
allowed-tools:
  - Read
  - Edit
  - Glob
  - Bash(git log:*, date:*)
---

Automatisches taegliches Standup. Zieht Daten aus Git-History und Memory
um Gestern/Heute/Blocker in 30 Sekunden zu generieren.

## Schritte

### Schritt 1: Datum-Kontext bestimmen

```bash
date +"%Y-%m-%d %A"
```

Bestimme "gestern":
- Wenn heute Montag → nutze Freitag (Wochenende ueberspringen)
- Sonst → den Vortag nutzen

### Schritt 2: Daten sammeln (parallel)

**Git-Aktivitaet (gestern):**
```bash
git log --after="yesterday 00:00" --before="today 00:00" --oneline --no-merges
```

Wenn keine Commits gestern, versuche die letzten 2 Tage.

**Letzte Daily Note:**
Lies die Daily Note von gestern (falls vorhanden) — scanne nach Entscheidungen,
Notizen und Tagesende-Zusammenfassung.

**Memory:**
Lies `.claude/memory.md` → aktuelle Aufgabe und offene Threads.

### Schritt 3: Standup generieren

Format:

```markdown
## Standup — [Tag, Datum]

### Gestern
- [Was erledigt wurde — aus Git Commits und Daily Note]
- [Zusammengehoerende Commits zusammenfassen]

### Heute
- [Prioritaets-Tasks aus Memory und offenen Threads]
- [Nach Wichtigkeit sortiert]

### Blocker
- [Alles was als blockiert markiert ist oder wartet]
- [Oder "Keine" wenn alles klar ist]
```

### Schritt 4: In Daily Note eintragen

Fuege das Standup in die heutige Daily Note ein unter `## Standup`.
Wenn noch keine Daily Note fuer heute existiert, erstelle eine
(folge dem Format aus `/start`).

### Schritt 5: Ausgabe

Zeige das Standup kurz und knapp. Halte es unter 10 Zeilen — Standups sollen schnell sein.

Wenn es Blocker gibt, hebe sie hervor.
Wenn alles klar ist, sage es deutlich.

## Wichtig
- MUST: Unter 10 Zeilen halten
- MUST: Montags das Wochenende ueberspringen (Freitag als "Gestern")
- MUST: Zusammengehoerende Commits gruppieren, nicht einzeln auflisten
- MUST: Einfache Sprache — kein Git-Jargon
