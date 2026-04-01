# Claude Cortex — Quickstart Guide

> Das kollektive Gehirn für Claude Code. Learnings, Rules, Hooks und Skills über alle deine Projekte hinweg.

---

## 1. Cortex in ein bestehendes Projekt installieren

Öffne ein Terminal in deinem Projekt-Ordner und führe diesen einen Befehl aus:

```bash
git clone --depth 1 https://github.com/NabilW1995/claude-cortex.git .cortex-temp && node .cortex-temp/scripts/template/install.js . && rm -rf .cortex-temp
```

**Was passiert:** Das Script scannt dein Projekt, kopiert die Cortex-Dateien rein (Agents, Rules, Hooks, Skills) und mergt intelligent mit deinen bestehenden Dateien — nichts wird überschrieben.

Danach:
```bash
npm install                    # sql.js für die Learning-Datenbank
npm run db:init                # Learning-Datenbank initialisieren
browser-use install            # Browser Use CLI (optional, für E2E Tests)
```

Optional — Google Stitch für Design:
```bash
cp .mcp.json.example .mcp.json    # Kopiere die MCP-Config
# Trage deinen Stitch API-Key ein in .mcp.json
```

---

## 2. Was jetzt automatisch passiert

Ab sofort läuft bei jeder Claude Code Session im Hintergrund:

| Wann | Was passiert | Hook |
|------|-------------|------|
| **Session-Start** | Alte Gate-Files aufräumen, Hooks prüfen, Learnings laden | session-reset.sh, session-start.js |
| **Jeder Prompt** | Korrektur-Erkennung, relevante Learnings suchen | prompt-submit.js |
| **Vor jedem Bash-Befehl** | Gefährliche Commands blockieren (rm -rf, force push, Secrets) | guard-bash.sh |
| **Vor jedem Write/Edit** | Backup erstellen, Secrets im Code erkennen, TODOs zählen | backup-before-write.sh, completeness-gate.sh |
| **Nach jedem Write/Edit** | Auto-Lint, Security-Scan, Tests laufen lassen | post-edit-lint.sh, security-scan.sh, auto-test.sh |
| **Bei Fehler** | Fehler kategorisieren und loggen | log-failures.sh |
| **Vor Komprimierung** | Session-Stand sichern | pre-compact.sh |
| **Nach Komprimierung** | Claude bekommt Anweisung wo der Stand ist | post-compact-resume.sh |
| **Session-Ende** | Learnings exportieren + pushen | session-end.js, auto-push-learnings.js |

**Du musst nichts davon manuell machen.** Es läuft einfach.

---

## 3. Was Claude jetzt automatisch tut

Diese Agents werden automatisch aktiviert basierend auf der Situation:

| Situation | Agent | Was passiert |
|-----------|-------|-------------|
| Du sagst "Bau mir ein Feature" | **coder** | 3-Phasen: Recherche → Implementierung → Verifizierung |
| Code ist fertig geschrieben | **test-runner** | Tests schreiben + laufen lassen (Pflicht!) |
| Build/Lint prüfen | **build-validator** | Build, Types, Lint checken |
| Du sagst "Review" | **code-review** | 7-Kategorien Review (Security, Performance, etc.) |
| Ein Fehler tritt auf | **error-whisperer** | Fehler in einfache Sprache übersetzen |
| Du steckst 3x fest | **rubber-duck** | Hilft dir das Problem zu formulieren |
| Du steckst 5x fest | **unsticker** | Root-Cause-Analyse |
| PR erstellen | **pr-ghostwriter** | PR-Beschreibung schreiben |
| Design/UI-Aufgabe | Design-Flow | Fragt: Stitch oder Lokal? |

---

## 4. Dein täglicher Workflow

### Morgens
```
/start          → Lädt den Stand von gestern, zeigt offene Aufgaben
```

### Während der Arbeit
```
/sync           → Zwischendurch Kurs prüfen (nach 3-4 Stunden)
/feature        → Neues Feature bauen (mit Branch + Tests)
/review         → Code prüfen lassen
/unstick        → Wenn du feststeckst
```

### Abends
```
/wrap-up        → Learnings sichern, morgen vorbereiten
```

### Bei Bedarf
```
/audit          → Learnings genehmigen oder ablehnen
/debt-map       → Tech-Schulden finden und priorisieren
/release        → Release Notes generieren
/standup        → 30-Sekunden Standup
/handoff        → Session an jemand anderen übergeben
/template-update → Cortex auf neueste Version updaten
```

Alle 22 Commands im Detail: `.claude/command-index.md`

---

## 5. Learnings — Wie das System lernt

### Automatisch
1. Claude macht einen Fehler → Du korrigierst → Claude fixt es → Du sagst "perfekt"
2. Claude extrahiert das Learning: Was war falsch? Was ist richtig?
3. Claude fragt dich sofort: "Soll das eine feste Regel werden?"
4. Bei Genehmigung → Learning wird zur festen Regel in `knowledge-base.md`

### Über Projekte hinweg
- Alle Learnings werden in einer **globalen SQLite-Datenbank** gespeichert (`~/.claude-learnings/learnings.db`)
- Auf DEINEM Rechner: Projekt A lernt → Projekt B weiß es sofort
- Für Teammates: `team-learnings.json` wird automatisch committed und gepusht

### Über das Template
- Learnings fließen in den `team-learnings.json` des Cortex GitHub Repos
- `/template-update` zieht neue Learnings von allen Projekten ins aktuelle Projekt

---

## 6. Cortex updaten

### Manuell
```bash
npm run cortex:update
```
Oder im Chat: `/template-update`

### Was beim Update passiert
1. Neueste Version von GitHub holen
2. Neue Rules, Hooks, Agents runterladen
3. CLAUDE.md intelligent mergen (deine Projekt-Sektionen bleiben)
4. settings.json intelligent mergen (deine Hooks bleiben)
5. Neue Learnings vom Team importieren
6. Changelog zeigen

### Automatischer Check
Alle 30 Minuten prüft ein Hintergrund-Check ob es Updates gibt. Wenn ja, siehst du in der StatusLine eine Benachrichtigung.

---

## 7. Neues Projekt von Null starten

```
/new-project
```

Claude führt dich durch ein Interview:
1. Was willst du bauen? (Web App, API, Mobile, etc.)
2. Welche Features? (Login, Datenbank, Payments, etc.)
3. Wie soll es aussehen? (Stitch Design oder lokal)
4. Tech-Stack Empfehlung mit Begründung
5. Projekt wird aufgesetzt mit Cortex vorinstalliert

---

## 8. Design-Workflow

Wenn du sagst "Bau mir eine Seite" fragt Claude:

**Option A: Google Stitch** (für ganze Seiten)
1. Deine Idee wird in einen präzisen Design-Prompt verwandelt
2. Premium Design-Regeln werden geladen (kein generisches AI-Design)
3. Stitch generiert das Design
4. Du reviewst in Stitch → genehmigst
5. Claude setzt es in Code um
6. Visuelles Review via Browser Use Screenshot

**Option B: Lokal** (für schnelle Komponenten)
1. `frontend-design` + `ui-ux-pro-max` Skills laden
2. Claude fragt nach Stil, Farben, Stimmung
3. 2-3 Optionen zur Auswahl
4. Code schreiben nach Genehmigung

---

## 9. Datei-Übersicht

```
Dein Projekt/
├── CLAUDE.md                     ← Projekt-Regeln (wird mit Cortex gemergt)
├── CLAUDE.local.md               ← Deine persönlichen Overrides (gitignored)
├── Task Board.md                 ← Kanban: Today / This Week / Backlog / Done
├── Scratchpad.md                 ← Schnelle Notizen (bei /sync verarbeitet)
├── Daily Notes/                  ← Automatische Tagesnotizen
├── .claude/
│   ├── agents/ (16)              ← Spezialisierte KI-Assistenten
│   ├── commands/ (22)            ← Slash-Commands (/start, /review, etc.)
│   ├── skills/ (34)              ← Fähigkeiten (Design, Legal, Product, etc.)
│   ├── rules/ (13)               ← Regeln (Security, Git, Testing, etc.)
│   ├── agent-memory/             ← Pro-Agent Gedächtnis
│   ├── settings.json             ← Hooks + Permissions
│   ├── knowledge-base.md         ← Genehmigte Regeln
│   ├── knowledge-nominations.md  ← Offene Learnings
│   ├── team-learnings.json       ← Team-Sync via Git
│   ├── command-index.md          ← Alle Commands auf einen Blick
│   ├── memory.md                 ← Aktueller Session-Stand
│   └── .claude-template.json     ← Cortex Version + Manifest
├── scripts/
│   ├── hooks/ (21)               ← Automatische Sicherheits- & Qualitäts-Checks
│   ├── db/                       ← SQLite Learning-Datenbank
│   └── template/                 ← Install/Update/Merge Scripts
├── .mcp.json                     ← MCP Server (Stitch + Knowledge Graph)
└── .gitignore                    ← Secrets + Logs geschützt
```

---

## 10. Häufige Fragen

**"Überschreibt Cortex meine bestehenden Dateien?"**
Nein. Das Install-Script mergt intelligent: Deine CLAUDE.md, settings.json und Agents bleiben erhalten. Neue Cortex-Dateien werden hinzugefügt, nicht überschrieben.

**"Funktioniert das auf Windows?"**
Ja. Alle Hooks nutzen `sed` statt `jq` (Windows-kompatibel). `PYTHONIOENCODING=utf-8` ist global gesetzt für Browser Use.

**"Brauche ich Stitch?"**
Nein, Stitch ist optional. Du kannst auch komplett lokal designen mit `frontend-design` + `ui-ux-pro-max`.

**"Was kostet das?"**
Claude Cortex selbst ist kostenlos (Open Source). Du brauchst nur einen Claude Code Zugang.

**"Kann ich Skills verbessern?"**
Ja! Nutze den Skill Creator: `/skill-creator:skill-creator` — er hilft dir jeden Skill zu verbessern und zu testen.
