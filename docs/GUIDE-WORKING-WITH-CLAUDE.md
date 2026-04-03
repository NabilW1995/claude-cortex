# Effektiv mit Claude arbeiten — Team Guide

> Basierend auf Boris Chernys Best Practices (Claude Code Team Lead bei Anthropic)
> und unserer eigenen Erfahrung mit dem Cortex Starter Template.

---

## Level 1: Die Basics (fur alle)

### Wie du mit Claude redest

| Tun | Nicht tun |
|-----|-----------|
| "Nein, das soll blau sein, nicht rot" | "Das stimmt nicht" (zu vage) |
| "Perfekt, genau so" (bestatigen!) | Einfach weitermachen ohne Feedback |
| "Check everything" | Manuell alle Dateien durchgehen |
| Screenshot teilen wenn UI nicht stimmt | Nur beschreiben was falsch aussieht |
| Plan Mode fur komplexe Aufgaben | Direkt Code schreiben lassen |

### Die wichtigsten Regeln

1. **Immer erst planen, dann bauen** — Shift+Tab 2x fur Plan Mode
2. **Korrekturen deutlich formulieren** — Claude lernt aus jeder Korrektur (unser Learning-System speichert das)
3. **Bestatigen wenn es funktioniert** — "Perfekt" oder "Genau so" triggert das Learning-System
4. **Screenshots teilen** bei visuellen Problemen — Claude kann Bilder sehen

### Dein Tag mit Claude

```
Morgens:   claude --agent=daily-start   → Automatische Morgenroutine (oder /start)
Tagsüber:  Plan Mode                    → Besprechen was zu bauen ist, dann Agents arbeiten lassen
           /audit                       → Neue Learnings prufen und bestatigen
Abends:    /wrap-up                     → Learnings sichern, fur morgen vorbereiten
```

---

## Level 2: Produktiver werden

### Context-Management

- **`/compact`** bei ~50% Context-Nutzung drucken (nicht warten bis voll!)
- **`/context`** zeigt wie viel Context-Window noch ubrig ist
- **`/rewind`** oder **Esc Esc** wenn Claude in die falsche Richtung geht — besser als im gleichen Kontext fixen
- **`/clear`** fur einen kompletten Neustart wenn alles durcheinander ist

### Effort-Level

- **`/effort high`** fur wichtige Aufgaben — Claude denkt grundlicher, braucht langer
- **`/effort medium`** fur Routine-Aufgaben — guter Kompromiss
- Standard-Effort ist in unseren Agents schon auf "high" gesetzt

### Bessere Ergebnisse

- **Detaillierte Beschreibungen > kurze Anweisungen** — "Erstelle ein Login-Formular mit E-Mail und Passwort, Validierung, und Error-States" statt "Mach ein Login"
- **Spezifikationen schreiben** — Je genauer du beschreibst was du willst, desto besser das Ergebnis
- **Nach jeder Korrektur**: "Update CLAUDE.md so you don't make that mistake again" — Claude schreibt Regeln fur sich selbst

---

## Level 3: Prompting-Techniken (von Boris Cherny)

### Code-Qualitat erhohen

| Prompt | Was es bewirkt |
|--------|---------------|
| "Grill me on these changes" | Claude wird zum strengen Reviewer — findet Fehler bevor der echte Review |
| "Knowing everything you know now, scrap this and implement the elegant solution" | Nach einem mittelmassigen Fix: nochmal neu, aber besser |
| "Use subagents" (an Anfrage anhangen) | Mehr Rechenpower — mehrere Claude-Instanzen arbeiten parallel |
| "Diff the behavior between main and this branch" | Verhaltensunterschiede finden |

### Bugs fixen lassen

- Fehlermeldung zeigen und einfach **"fix"** sagen — Claude kann die meisten Bugs selbst finden und beheben
- **"Go fix the failing CI tests"** — Claude checkt die CI Pipeline und fixt Fehler
- **Docker-Logs zeigen** fur verteilte Systeme

### Plane verbessern

- Plan Mode starten → hin und her diskutieren bis der Plan gut ist → dann erst bauen lassen
- **"Act as a staff engineer and review this plan"** — Claude pruft den eigenen Plan kritisch
- Wenn etwas schief geht: **Zuruck in Plan Mode** statt im Chaos weitermachen

---

## Level 4: Power Features

### Wiederkehrende Tasks automatisieren

```
/loop 5m /health          → Health-Check alle 5 Minuten
/loop 30m /simplify       → Code vereinfachen alle 30 Min
/loop 1h /metrics         → Projekt-Metriken jede Stunde
```

### Paralleles Arbeiten

- **`/branch`** — Konversation forken fur Experimente (Original bleibt erhalten)
- **`claude -w`** — Neues Terminal mit Git Worktree (Boris: "Single biggest productivity unlock")
- **`/btw`** — Nebenfragen stellen ohne den laufenden Agent zu unterbrechen

### Agent Teams (Beta — aktiviert)

Mehrere Claude-Instanzen arbeiten parallel an einem Projekt, jede mit eigenem Context-Window:

```
Beispiel: "Build user authentication"
  → Teammate 1: Backend (API + DB)
  → Teammate 2: Frontend (Login UI)
  → Teammate 3: Tests (Unit + E2E)
  Alle arbeiten gleichzeitig, koordinieren uber shared Task List
```

- Aktiviert uber `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings.json
- Nutzt tmux fur geteilte Terminal-Fenster (oder `--teammate-mode in-process`)
- Jeder Teammate hat eigene CLAUDE.md, Skills, MCPs
- Mehr Context-Windows = bessere Ergebnisse (Boris Tipp #37)

### Spracheingabe

- **`/voice`** — Push-to-talk aktivieren (Leertaste gedruckt halten)
- Boris macht den Grosssteil seiner Arbeit per Sprache — 3x schneller als tippen
- Prompts werden detaillierter wenn man spricht statt tippt

### Weitere nutzliche Commands

| Command | Was es tut |
|---------|-----------|
| `/effort high` | Mehr Intelligenz, grundlichere Arbeit |
| `/compact` | Kontext komprimieren (bei ~50% nutzen!) |
| `/rewind` | Letzte Anderungen ruckgangig machen |
| `/branch` | Konversation forken fur Experimente |
| `/context` | Zeigt wie viel Context-Window ubrig |
| `/voice` | Spracheingabe aktivieren |
| `/diff` | Interaktiver Diff-Viewer fur Anderungen |
| `/powerup` | Interaktive Tutorials zum Lernen |
| `/doctor` | Diagnostik wenn etwas nicht funktioniert |
| `/sandbox` | Sandbox-Modus (84% weniger Permission-Prompts) |

---

## Was automatisch im Hintergrund lauft

Du musst nichts davon manuell starten — es passiert automatisch:

| Feature | Wann | Was es tut |
|---------|------|-----------|
| **Security-Scan** | Nach jedem Edit | Pruft auf Secrets, XSS, SQL Injection |
| **Auto-Format** | Nach jedem Edit | Code wird automatisch formatiert |
| **Guard-Bash** | Vor jedem Bash-Befehl | Blockiert rm -rf, force push, chmod 777 |
| **Learning-System** | Bei Korrekturen | Erkennt Fehler, speichert Learnings, fragt ob permanent |
| **Stop-Verifikation** | Wenn Claude aufhort | Pruft ob Arbeit wirklich vollstandig ist |
| **Backup** | Vor jedem Edit | 7-Tage Backup aller geanderten Dateien |
| **Update-Check** | Bei Session-Start | Zeigt ob neue Cortex-Version verfugbar |
| **Vulnerability-Check** | Bei Session-Start | Pruft npm auf bekannte Sicherheitslucken |

---

## Unsere Agents

Agents sind spezialisierte KI-Mitarbeiter. Sie werden automatisch eingesetzt — du musst sie nicht manuell aufrufen.

| Agent | Wann aktiv | Farbe | Memory |
|-------|-----------|-------|--------|
| **core--coder** | Jede Code-Aufgabe >10 Zeilen | Blau | Merkt sich Projekt-Patterns |
| **core--test-runner** | Nach jedem Coder-Task (automatisch) | Grun | Merkt sich Test-Ergebnisse |
| **core--code-review** | Nach Tests bestanden (automatisch) | Gelb | Merkt sich Review-Feedback |
| **pre--architect** | Vor komplexen Features (manuell) | Cyan | Merkt sich Architektur |
| **fix--error-translator** | Bei kryptischen Fehlermeldungen | Rot | — |
| **fix--root-cause-finder** | Bei hartnackigen Bugs | Rot | — |
| **start--onboarding** | Einmalig bei neuem Projekt | Magenta | — |
| **util--pr-writer** | Beim Erstellen von Pull Requests | Weiss | — |

### Der automatische Pipeline-Flow

```
Du sagst "Build feature X"
  → Plan Mode (du und Claude besprechen den Ansatz)
  → core--coder (schreibt Code + Tests)
  → core--test-runner (testet alles)
  → core--code-review (pruft Qualitat)
  → sanity-check (passt alles zusammen?)
  → Done
```

---

## Unsere Skills

Skills werden automatisch erkannt wenn du bestimmte Worte sagst:

| Skill | Sag das... | Was passiert |
|-------|-----------|-------------|
| **sanity-check** | "Check everything", "production ready?" | Pruft ob alles zusammenpasst |
| **scaffolding** | "Erstelle das Projekt", "set it up" | Neues Projekt aufsetzen |
| **project-discovery** | "Neues Projekt", "I want to build" | Interview was du bauen willst |
| **frontend-design** | "Build me a page", "design" | Professionelles UI Design |
| **ui-ux-pro-max** | "Welche Farben?", "how should this look?" | Farben, Fonts, Styles |
| **continuous-learning** | *(automatisch bei Korrekturen)* | Lernt aus deinem Feedback |

---

## CLAUDE.md pflegen

Die CLAUDE.md ist das "Gehirn" des Projekts — hier stehen die Regeln die Claude befolgt.

- **Unter 200 Zeilen halten** — zu lang = Claude ignoriert Teile
- **Nach jeder Korrektur updaten**: "Update CLAUDE.md so you don't make that mistake again"
- **Team-Regeln** → `.claude/settings.json` (deterministisch, nicht interpretierbar)
- **Personliche Regeln** → `CLAUDE.local.md` (gitignored, nur fur dich)
- **Ordner-spezifische Regeln** → CLAUDE.md im jeweiligen Ordner (ladt automatisch wenn dort gearbeitet wird)

---

## Quellen

- [Boris Cherny's Claude Code Best Practices](https://github.com/shanraisshan/claude-code-best-practice) — 87 Tips, Workflows, Agent Patterns
- [Thariq's Skills Lessons](https://x.com/trq212/status/2033949937936085378) — Wie man effektive Skills baut
- [Claude Code Docs](https://docs.anthropic.com/en/docs/claude-code) — Offizielle Dokumentation
