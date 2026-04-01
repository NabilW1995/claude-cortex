---
description: System-Gesundheitscheck — Agents, Commands, Hooks, Memory, Knowledge-Base pruefen
argument-hint: ""
allowed-tools:
  - Read
  - Glob
  - Grep
  - Agent
  - Write
  - Edit
  - Bash(date:*, wc:*)
---

Umfassender Infrastruktur-Audit. Monatlich ausfuehren oder nach groesseren System-Aenderungen.

## Pruefungen

### Pruefung 1: Agent-Gesundheit
- Lies alle Dateien in `.claude/agents/*.md`
- Pruefe ob jede gueltige Frontmatter hat (---)
- Pruefe auf TBD/TODO Marker (sollten nicht vorhanden sein)
- Pruefe ob referenzierte Tools existieren
- Zaehle: Agents gesamt, mit Frontmatter, ohne Probleme

### Pruefung 2: Command-Gesundheit
- Lies alle Dateien in `.claude/commands/*.md`
- Pruefe ob jede gueltige YAML-Frontmatter hat
- Pruefe ob allowed-tools sinnvoll sind
- Pruefe auf kaputte Querverweise zu anderen Commands
- Zaehle: Commands gesamt, mit Frontmatter, ohne Probleme

### Pruefung 3: Hook-Gesundheit
- Pruefe ob `.claude/settings.json` valides JSON ist
- Pruefe ob jedes referenzierte Hook-Script existiert
- Pruefe auf verwaiste Hook-Scripts (existieren aber nicht in settings.json)
- Pruefe auf fehlende Hook-Scripts (in settings.json aber nicht vorhanden)

### Pruefung 4: Memory-Tier Gesundheit
- `memory.md`: Unter 100 Zeilen? Ist "Now" aktuell?
- `knowledge-base.md`: Unter 200 Zeilen? Haben alle Eintraege [Source:]?
- `knowledge-nominations.md`: Gibt es veraltete Nominations (>30 Tage)?
- `daily-notes/`: Sind aktuelle Notes vorhanden?
- SQLite DB: Ist die Learnings-DB erreichbar und intakt?

### Pruefung 5: Skills-Gesundheit
- Lies alle Dateien in `.claude/skills/`
- Pruefe ob SKILL.md Dateien vorhanden sind
- Pruefe auf kaputte Referenzen in Skills

### Pruefung 6: Cross-File Kohaerenz
- CLAUDE.md Referenzen stimmen mit tatsaechlichen Datei-Pfaden ueberein
- Keine zirkulaeren Abhaengigkeiten zwischen Commands
- Agent-Routing Tabelle stimmt mit tatsaechlichen Agents ueberein
- Rules-Verzeichnis: Alle referenzierten Regeln existieren

### Pruefung 7: Cortex-System Gesundheit
- `.claude-template.json` vorhanden und valide
- Scripts-Verzeichnis: Alle referenzierten Scripts existieren
- package.json: Cortex-Scripts (db:init, cortex:update) vorhanden

### Pruefung 8: Via-Negativa Sweep
- Gibt es Dateien/Agents/Commands die nie genutzt werden?
- Koennte ein Hook entfernt werden ohne Verlust?
- Gibt es duplizierte Logik zwischen Agents?
- Vorschlaege fuer Vereinfachungen — weniger ist besser

## Bewertung

| Note | Kriterien |
|------|-----------|
| A | Alle Pruefungen bestanden, keine Probleme |
| B | Nur kleinere Probleme (kosmetisch, nicht blockierend) |
| C | Einige Probleme brauchen Aufmerksamkeit (fehlende Provenance, veraltete Nominations) |
| D | Strukturelle Probleme (kaputte Hooks, invalides JSON, fehlende Agents) |
| F | Kritische Fehler (Sicherheitsprobleme, Datenverlust-Risiko) |

## Ausgabe

Zeige Ergebnisse als strukturierten Bericht:

```markdown
## System-Audit — [Datum]

**Note:** [A-F]
**Pruefungen:** [bestanden]/8
**Probleme:**
- [Problem mit Schweregrad]

**Aktionen:**
- [Korrektur-Aufgabe bei D/F Noten]
```

Bei D oder F Noten: Erstelle konkrete Korrektur-Aufgaben und biete an sie sofort zu fixen.

## Wichtig
- MUST: Erklaere jedes Problem in einfacher Sprache
- MUST: Bei D/F Noten sofortige Korrektur anbieten
- MUST: NIEMALS Secret-Werte aus settings.json anzeigen
- MUST: Vereinfachungen vorschlagen (Via Negativa)
