---
description: Konfigurations-Drift erkennen — Widersprueche, verwaiste Dateien, veraltete Eintraege
argument-hint: ""
allowed-tools:
  - Read
  - Agent
  - Glob
  - Grep
  - Bash(wc:*, date:*)
---

Selbst-Monitoring Command. Scannt die gesamte Claude-Code-Konfiguration nach Drift —
veraltete Regeln, Widersprueche, verwaiste Dateien und Inkonsistenzen.

## Schritte

### Schritt 1: System-Dateien scannen (parallel)

Lies alle Konfigurations-Quellen gleichzeitig:
- `CLAUDE.md` — Projekt-Anweisungen
- `.claude/memory.md` — aktives Memory
- `.claude/knowledge-base.md` — gelernte Regeln
- `.claude/settings.json` — Hooks-Konfiguration
- `.claude/knowledge-nominations.md` — offene Nominations

### Schritt 2: Widersprueche pruefen

**Innerhalb CLAUDE.md:**
- Gibt es widersprueche Anweisungen? (z.B. "immer X tun" und "nie X tun")
- Gibt es Referenzen auf Dateien oder Verzeichnisse die nicht existieren?
- Gibt es Referenzen auf Commands oder Agents die nicht definiert sind?

**Zwischen CLAUDE.md und Knowledge-Base:**
- Enthaelt die Knowledge-Base Regeln die CLAUDE.md widersprechen?
- Gibt es doppelte Regeln in beiden Dateien?

**Zwischen Memory und Realitaet:**
- Referenziert Memory Tasks, Dateien oder Zustaende die nicht mehr existieren?
- Gibt es "aktueller Fokus" Items die offensichtlich veraltet sind?

### Schritt 3: Verwaiste Elemente pruefen

Scanne nach:
- **Verwaiste Commands:** Dateien in `.claude/commands/` die nirgends referenziert werden
- **Verwaiste Agents:** Agent-Definitionen die kein Command oder Skill aufruft
- **Verwaiste Skills:** Skills die von keinem Command, Agent oder CLAUDE.md referenziert werden
- **Tote Referenzen:** Erwaehnte Dateien, URLs oder Pfade die nicht existieren
- **Ungenutzte Hooks:** Hook-Scripts die existieren aber nicht in settings.json verdrahtet sind

### Schritt 4: Veraltung pruefen

- **Memory.md:** Ist die "Now" Sektion aelter als 3 Tage?
- **Knowledge-Base Eintraege:** Referenzieren welche veraltete Tools, APIs oder Patterns?
- **Daily Notes:** Gibt es Daily Notes aelter als 30 Tage die archiviert werden sollten?
- **Nominations:** Gibt es Nominations die laenger als 30 Tage offen sind?

### Schritt 5: Konfigurations-Gesundheit pruefen

- **settings.json:** Ist es valides JSON? Existieren alle referenzierten Hook-Scripts?
- **CLAUDE.md Groesse:** Wird sie zu gross? (>500 Zeilen = Warnung)
- **Memory.md Groesse:** Innerhalb der Limits? (<100 Zeilen Ziel)
- **Knowledge-Base Groesse:** Innerhalb der Limits? (<200 Zeilen Ziel)

### Schritt 6: Drift-Report generieren

```markdown
# Drift-Erkennung — Bericht

**Datum:** [datum]
**Status:** [SAUBER / WARNUNGEN / PROBLEME GEFUNDEN]

## Widersprueche
- [Widerspruch mit Datei-Referenzen]

## Verwaiste Elemente
- [Verwaiste Datei oder Referenz]

## Veraltete Eintraege
- [Veraltetes Memory, Task oder Referenz]

## Konfigurations-Gesundheit
| Pruefung | Status | Hinweis |
|----------|--------|---------|
| settings.json valide | Pass/Fail | |
| CLAUDE.md Groesse | [Zeilen] | [ok / Warnung] |
| memory.md Groesse | [Zeilen] | [ok / Warnung] |
| Knowledge-Base Groesse | [Zeilen] | [ok / Warnung] |

## Empfohlene Aktionen
1. [Konkreter Fix]
2. [Konkreter Fix]
3. [Konkreter Fix]

---
Monatlich ausfuehren oder wenn das System sich seltsam verhaelt.
```

Zeige den Status und kritische Probleme. Biete an, einfache Probleme automatisch zu fixen.

## Wichtig
- MUST: Alle Probleme in einfacher Sprache erklaeren
- MUST: Konkrete Fix-Vorschlaege machen
- MUST: Nicht automatisch fixen ohne User-Erlaubnis
- MUST: Verwaiste Elemente NICHT loeschen — nur melden
