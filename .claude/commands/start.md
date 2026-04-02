---
description: Tagesbeginn — Memory laden, Learnings pruefen, bereit zum Arbeiten
argument-hint: ""
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash(date:*, python3:*, python:*)
---

Starte eine neue Arbeitssession. Lade Kontext, erstelle die Daily Note, pruefe Learnings.

## First-Run Detection

Check if `.claude/logs/.session-id` exists. If NOT (first time using Cortex in this project):

Show a welcome tour INSTEAD of the normal start flow:

```
Welcome to Claude Cortex!

Your project now has superpowers. Here's what's active:

DEVELOPMENT PIPELINE (automatic):
  Plan Mode → core--coder → core--test-runner → core--code-review → sanity-check
  Just say "Build me [feature]" and the pipeline handles the rest.

COMMANDS you can use:
  /start      — This! Morning routine.
  /health     — Check if everything is working
  /metrics    — Code stats (LOC, complexity, coverage)
  /changelog  — Generate changelog from git history
  /audit      — Review and approve learnings
  /wrap-up    — End of day ritual

HOOKS (run automatically, no action needed):
  After every file edit: lint, tests, security scan
  Session start: load learnings, check .env
  Dangerous commands: blocked automatically

LEARNING SYSTEM:
  Correct me when I'm wrong → I learn and never repeat the mistake.
  Learnings are shared with your team via git.

Ready to work! What would you like to build?
```

After showing the tour, create the `.claude/logs/.session-id` file to mark first run as complete, then STOP (don't run the normal flow).

## Normal Flow (not first run)

### Schritt 1: Datum holen

```bash
date +"%Y-%m-%d %H:%M %A"
```

### Schritt 2: Kontext laden (parallele Reads)

Lies gleichzeitig:
- `.claude/memory.md` — aktueller Stand und offene Threads
- `.claude/knowledge-base.md` — gelernte Regeln (Pflicht-Constraints)
- `.claude/knowledge-nominations.md` — offene Nominations (kurzer Check)

### Schritt 3: Learnings aus SQLite laden

Lade die letzten 10 relevanten Learnings:
```python
import sqlite3
conn = sqlite3.connect(r'C:\Users\Nabil\.claude-learnings\learnings.db')
c = conn.cursor()
c.execute("""SELECT category, rule, confidence FROM learnings
             ORDER BY created_at DESC LIMIT 10""")
```

Pruefe ob Learnings zum aktuellen Kontext passen.

### Schritt 4: Daily Note erstellen

Erstelle `daily-notes/YYYY-MM-DD.md` (nur wenn noch nicht vorhanden):
```markdown
# [Datum] — Arbeitsprotokoll

## Entscheidungen
-

## Notizen
-

## Tagesende-Zusammenfassung
-
```

### Schritt 5: Cortex Sync-Check

Pruefe ob ein Template-Update verfuegbar ist:
- Lies `.claude-template.json` fuer aktuelle Version
- Hinweis: "Cortex-Update verfuegbar? Fuehre `/template-update` aus."
- Nur hinweisen, nicht automatisch updaten.

### Schritt 6: Umgebungs-Check

- Pruefe `.env` gegen `.env.example` — fehlen Variablen?
- MUST: Zeige NIEMALS echte Secret-Werte, nur Variablen-Namen
- Bei fehlenden Variablen: Warnung und Erklaerung was sie tun

### Schritt 7: Task-Ueberblick

Lies die letzte Daily Note und Memory fuer:
- Was wurde zuletzt gemacht?
- Welche Tasks sind offen?
- Gibt es veraltete Tasks (aelter als 3 Tage, noch offen)?
- Gibt es Blocker?

Markiere veraltete Tasks mit einem Hinweis.

### Schritt 8: Bereit zum Arbeiten

Zeige eine kurze Orientierung (max 10 Zeilen):
- Welcher Tag es ist
- Top 1-3 Prioritaeten fuer heute
- Blocker oder offene Threads aus memory.md
- Relevante Learnings (wenn passend)
- "Bereit zum Arbeiten. Woran moechtest du heute arbeiten?"

Halte es kurz. Der User will arbeiten, nicht einen Bericht lesen.

## Wichtig
- MUST: Einfache Sprache — kein Fachjargon
- MUST: Zusammenfassung unter 10 Zeilen
- MUST: Frage am Ende was der User heute machen will
- MUST: Zeige NIEMALS Secret-Werte aus .env
