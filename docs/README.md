# Dokumentation — Claude Cortex Starter Template

## Erste Schritte

| Dokument | Fuer wen | Inhalt |
|----------|----------|--------|
| [QUICKSTART-CORTEX.md](QUICKSTART-CORTEX.md) | Neue Nutzer | Installation, erste Schritte, Dateiuebersicht |
| [QUICKSTART-TELEGRAM.md](QUICKSTART-TELEGRAM.md) | Team-Admins | Telegram Bot Setup fuer Team-Koordination |

## Guides

| Dokument | Fuer wen | Inhalt |
|----------|----------|--------|
| [GUIDE-WORKING-WITH-CLAUDE.md](GUIDE-WORKING-WITH-CLAUDE.md) | Alle | Wie man effektiv mit Claude arbeitet (4 Level: Basics → Power Features) |

## Workflows

| Dokument | Wann nutzen | Inhalt |
|----------|-------------|--------|
| [WORKFLOW-RPI.md](WORKFLOW-RPI.md) | Grosse Features | Research → Plan → Implement mit 3 Commands und 9 Agents |
| [WORKFLOW-CROSS-MODEL.md](WORKFLOW-CROSS-MODEL.md) | Kritische Features | Claude + Codex zusammen — zwei Modelle pruefen sich gegenseitig |

## Wie waehle ich den richtigen Workflow?

```
"Ich will was bauen"
  │
  ├─ Klein (< 1 Stunde, < 100 Zeilen)?
  │   → /build-feature → Direkt oder Pipeline
  │
  ├─ Mittel (1-4 Stunden, neues Feature)?
  │   → /build-feature → Pipeline oder Agent Teams
  │
  ├─ Gross (> 4 Stunden, mehrere Bereiche)?
  │   → /rpi-research → /rpi-plan → /rpi-implement
  │
  └─ Kritisch (Auth, Payment, Security)?
      → RPI + Cross-Model Review
```

## Alle Commands auf einen Blick

### Taeglich
| Command | Was |
|---------|-----|
| `/start` | Morgenroutine (oder `claude --agent=daily-start`) |
| `/wrap-up` | Feierabend — Learnings sichern |
| `/audit` | Neue Learnings pruefen |

### Features bauen
| Command | Was |
|---------|-----|
| `/build-feature` | Einfaches bis mittleres Feature (Plan → Strategie → Execute) |
| `/rpi-research` | RPI Phase 1: Machbarkeitsanalyse |
| `/rpi-plan` | RPI Phase 2: Detailplan mit 3 parallelen Agents |
| `/rpi-implement` | RPI Phase 3: Phase-fuer-Phase Umsetzung |
| `/new-project` | Komplett neues Projekt von Null |

### Qualitaet
| Command | Was |
|---------|-----|
| `/sanity-check` | Passt alles zusammen? |
| `/health` | Cortex Health Check |
| `/metrics` | Code-Metriken anzeigen |
| `/drift-check` | Neue Claude Code Features die wir nicht nutzen |

### Loops (laufen im Hintergrund)
| Command | Was | Intervall |
|---------|-----|-----------|
| `/loop-simplify` | Code aufraumen | 30 Min |
| `/loop-watch-tests` | Tests ueberwachen | 10 Min |
| `/loop-health` | Health Check | 1 Stunde |

### Sonstiges
| Command | Was |
|---------|-----|
| `/changelog` | Changelog generieren |
| `/learn` | Learnings durchsuchen |
| `/template-update` | Cortex aktualisieren |
| `/onboard` | Codebase zum ersten Mal scannen |
