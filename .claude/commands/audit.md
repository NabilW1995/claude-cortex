---
description: Learnings reviewen, Knowledge-Nominations pruefen und Qualitaets-Audit durchfuehren
argument-hint: "[scope oder leer fuer offene Nominations]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Agent
  - Bash(python3:*, python:*, date:*)
---

Fuehre ein Qualitaets-Audit durch — pruefe offene Learnings, reviewe Knowledge-Nominations
und bewerte die Qualitaet der letzten Arbeit.

## Schritte

### Schritt 1: Audit-Tier bestimmen

| Tier | Wann | Tiefe |
|------|------|-------|
| T1 | Tagesende (/wrap-up), schneller Check | Offene Nominations pruefen, 2-3 Min |
| T2 | Nach Feature-Completion, expliziter /audit Aufruf | Nominations + Code-Qualitaet + Konsistenz |
| T3 | Wochen-Review, nach groesseren Aenderungen | Volle Regressionspruefung, Knowledge-Base Sweep |
| T4 | Monatlich oder nach System-Aenderungen | Tiefen-Audit: Cross-File Kohaerenz, DB-Integritaet |

Standard bei `/audit` ohne Argument: T2.
Wenn der User einen Scope angegeben hat (Datei, Task, Bereich), nutze diesen als Audit-Ziel.

### Schritt 2: Daten sammeln (parallel)

**Datenquelle 1 — SQLite Learnings-DB:**
```python
import sqlite3
conn = sqlite3.connect(r'C:\Users\Nabil\.claude-learnings\learnings.db')
c = conn.cursor()
c.execute("""SELECT n.id, l.category, l.project, l.confidence, l.rule, l.rule_en,
             l.mistake, l.mistake_en, l.correction, l.correction_en
             FROM nominations n JOIN learnings l ON n.learning_id = l.id
             WHERE n.status = 'pending' ORDER BY l.confidence DESC""")
```

**Datenquelle 2 — Knowledge-Nominations Datei:**
- Lies `.claude/knowledge-nominations.md`
- Vergleiche mit DB-Stand — sind sie synchron?

**Datenquelle 3 — Knowledge-Base:**
- Lies `.claude/knowledge-base.md`
- Pruefe auf Duplikate oder Widersprueche

### Schritt 3: Auditor-Agent dispatchen (bei T2+)

Bei Tier 2 oder hoeher — dispatche den Auditor-Agent als Subagent:

```
Agent(auditor): [Tier]-Audit von [Scope].

Kontext:
- [Was wurde gemacht / welche Dateien betroffen]
- [Offene Nominations: X Stueck]

Pruefe:
1. Vollstaendigkeit — wurden alle Anforderungen erfuellt?
2. Konsistenz — passen Aenderungen zu bestehenden Patterns?
3. Seiteneffekte — hat etwas Downstream gebrochen?
4. Knowledge — gibt es Learnings zum Promoten?

Ergebnis als PASS/WARN/FAIL mit Datei:Zeile Referenzen.
```

### Schritt 4: Nominations einzeln reviewen

Fuer JEDE pending Nomination dem User zeigen:
```
--- Nomination #[id] ---
Kategorie: [category]
Projekt: [project oder "global"]
Confidence: [confidence]

Regel (DE): [rule]
Regel (EN): [rule_en]
Fehler: [mistake]
Korrektur: [correction]
```

MUST: Erklaere in einfacher Sprache was das Learning bedeutet.
MUST: Warte auf User-Entscheidung bei JEDEM Learning.

### Schritt 5: Entscheidung verarbeiten

**Bei Genehmigung:**
- Nomination-Status auf 'approved' setzen (reviewed_at + promoted_at = jetzt)
- Confidence um 0.2 erhoehen (max 1.0)
- In `.claude/knowledge-base.md` eintragen:
  ```
  ### [Category]: [Rule]
  - Fehler: [mistake]
  - Korrektur: [correction]
  - [Source: learning-db #ID, approved DATUM]
  ```
- In `.claude/knowledge-nominations.md` unter "Recently Approved" eintragen

**Bei Ablehnung:**
- Status auf 'rejected', reviewed_at = jetzt
- Confidence um 0.1 reduzieren
- Nach Begruendung fragen (reviewer_notes speichern)
- In `.claude/knowledge-nominations.md` unter "Recently Rejected" eintragen

### Schritt 6: Verdict und Zusammenfassung

Zeige dem User das Gesamtergebnis:
```
## Audit-Ergebnis — [Datum] (T[tier])

Ergebnis: [PASS / WARN / FAIL]

Nominations: [X] genehmigt, [Y] abgelehnt, [Z] noch offen
Knowledge-Base: [Anzahl] Regeln gesamt
Findings: [Aufzaehlung der Erkenntnisse]
Aktionen: [Was als naechstes passieren sollte]
```

## Wichtig
- MUST: Jedes Learning einzeln zeigen — nicht alle auf einmal
- MUST: DB und Markdown-Dateien synchron halten
- MUST: Zweisprachige Learnings (DE + EN) pruefen
- MUST: Einfache Sprache fuer alle Erklaerungen
- DB-Pfad: C:\Users\Nabil\.claude-learnings\learnings.db (via Python sqlite3)
