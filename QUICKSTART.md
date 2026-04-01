# Claude Starter Team Template — Quickstart Guide

## Erstmaliges Setup (einmal pro Rechner)

```bash
# 1. Template-Ordner kopieren
cp -r "Claude Starter Team Template" mein-neues-projekt
cd mein-neues-projekt

# 2. Dependencies installieren (erstellt auch die Learnings-Datenbank)
npm install

# 3. Claude Code starten
claude

# 4. Neues Projekt starten
/new-project
```

---

## Workflow: Neues Projekt starten

```
/new-project
```

Claude fragt dich 10-20 Fragen (eine nach der anderen):
- Was willst du bauen?
- Wie heißt das Projekt?
- Wer sind die User?
- Braucht es Login?
- Welche Farben/Fonts?
- Wo soll es deployen?
- ...

Danach: Claude empfiehlt Tech-Stack → du sagst OK → Projekt wird aufgesetzt.

---

## Workflow: Tägliche Arbeit

### Morgens: Session starten
```
/start
```
Claude zeigt dir: Was zuletzt gemacht wurde, offene Tasks, relevante Learnings.

### Neues Feature bauen
```
/feature
```
Claude fragt was du bauen willst → erstellt Branch → baut → zeigt Preview-Link.

### Oder einfach drauf los reden
Du musst NICHT immer Commands nutzen. Sag einfach was du willst:

| Du sagst... | Was passiert |
|---|---|
| "Bau mir eine Kontaktseite" | frontend-design + ui-ux-pro-max Skills aktivieren automatisch |
| "Der Login funktioniert nicht" | Unsticker-Agent hilft |
| "Was bedeutet dieser Fehler?" | Error-Whisperer übersetzt |
| "Ich komme nicht weiter" | `/unstick` oder sag es einfach |
| "Was haben wir letzte Woche gemacht?" | `/learn` zeigt Learnings |

### Mittags: Sync (optional)
```
/sync
```
Aktualisiert den Kontext wenn du lange arbeitest.

### Abends: Session beenden
```
/wrap-up
```
Claude erstellt Daily Note, speichert Learnings, bereitet morgen vor.

---

## Alle Commands auf einen Blick

| Command | Wann nutzen | Was passiert |
|---|---|---|
| `/new-project` | Einmal am Anfang | Interview → Scaffolding → Setup |
| `/start` | Jeden Morgen | Lädt Kontext + Learnings |
| `/feature` | Neues Feature | Branch → Build → Preview-Link |
| `/sync` | Mittags (optional) | Kontext refreshen |
| `/wrap-up` | Jeden Abend | Daily Note + Learnings speichern |
| `/learn` | Jederzeit | Learnings anzeigen/suchen |
| `/learn login` | Jederzeit | Learnings zum Thema "login" suchen |
| `/unstick` | Wenn du feststeckst | Root-Cause Analyse |
| `/onboard` | Neues/fremdes Projekt | Codebase in 5 Min verstehen |
| `/cleanup` | Nach Setup oder Refactor | Unnötige Dateien entfernen |

---

## Team-Workflow

### Deine Fehler teilen (automatisch)
Wenn du committest, werden deine bestätigten Learnings automatisch in
`.claude/team-learnings.json` exportiert und mit-committed.

### Learnings von Teammates bekommen (automatisch)
Wenn du eine neue Session startest, werden Learnings deiner Teammates
automatisch in deine lokale DB importiert.

### Manuell Team-Learnings prüfen
```bash
npm run team:stats    # Wer hat wie viele Learnings?
npm run learn:stats   # Alle Learnings anzeigen
```

---

## Wie das Lernsystem funktioniert

Du musst NICHTS Besonderes tun. Einfach normal arbeiten:

```
Du: "Zentrier mal den Text"
Claude: *macht es falsch*
Du: "Nein, links und rechts stimmt noch nicht"
Claude: *versucht nochmal*
Du: "Immer noch nicht richtig"
Claude: *findet die Lösung*
Du: "Perfekt, jetzt passt es!"
    → Learning wird AUTOMATISCH gespeichert
    → Nächstes Mal macht Claude es direkt richtig
```

### Was erkannt wird (Deutsch + Englisch)

| Korrektur-Signale | Erfolgs-Signale |
|---|---|
| "nein", "falsch", "stimmt nicht" | "perfekt", "genau", "funktioniert" |
| "passt nicht", "immer noch nicht" | "super", "endlich", "ja genau so" |
| "no", "wrong", "not right" | "perfect", "works", "exactly" |
| "undo", "revert", "stop" | "great", "nice", "that's it" |

---

## NPM Scripts

```bash
npm run db:init       # Datenbank initialisieren
npm run db:reset      # Datenbank zurücksetzen (Backup wird erstellt)
npm run learn:search  # Learnings durchsuchen
npm run learn:stats   # Statistiken anzeigen
npm run team:export   # Learnings exportieren
npm run team:import   # Team-Learnings importieren
npm run team:stats    # Team-Statistiken
```

---

## Ordner-Übersicht

```
dein-projekt/
├── CLAUDE.md                  ← Regeln für Claude (NICHT bearbeiten)
├── CLAUDE.local.md            ← Deine persönlichen Einstellungen
├── QUICKSTART.md              ← Diese Datei
├── .claude/
│   ├── commands/              ← 9 Slash-Commands
│   ├── skills/                ← 5 Skills (Discovery, Scaffolding, Learning, Design, UX)
│   ├── agents/                ← 6 Agents (Auditor, Unsticker, Error-Whisperer...)
│   ├── rules/                 ← 6 Regelwerke (Security, Git, A11y...)
│   ├── settings.json          ← Hook-Konfiguration
│   ├── memory.md              ← Aktueller Session-Kontext
│   ├── knowledge-base.md      ← Bestätigte Learnings
│   └── team-learnings.json    ← Geteilte Team-Learnings
├── scripts/
│   ├── hooks/                 ← 16 automatische Hooks
│   ├── db/                    ← SQLite Lernsystem
│   └── cleanup/               ← Aufräum-Script
└── docs/plans/                ← Design-Dokumente
```

---

## FAQ

**Muss ich programmieren können?**
Nein. Sag Claude was du willst, Claude macht den Rest und erklärt dir was passiert ist.

**Was ist wenn Claude einen Fehler macht?**
Sag es einfach: "Das stimmt nicht" oder "Das passt noch nicht". Claude korrigiert sich und lernt daraus.

**Funktioniert das auf Deutsch?**
Ja, komplett. Deutsch und Englisch werden beide erkannt.

**Wo werden meine Learnings gespeichert?**
Lokal auf deinem Rechner: `~/.claude-learnings/learnings.db`
Team-Learnings: im Git-Repo unter `.claude/team-learnings.json`

**Kann ich das Template für verschiedene Projekte nutzen?**
Ja — kopiere den Ordner, starte `/new-project`, und das Template passt sich an.
