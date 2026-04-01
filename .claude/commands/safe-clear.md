---
description: Sicherer Kontext-Flush — Session-Stand sichern und nahtlos weiterarbeiten
argument-hint: ""
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash(date:*, python3:*, python:*)
---

Session-Stand sichern und dann mit frischem Kontext weiterarbeiten.
Der User sollte davon moeglichst wenig mitbekommen.

**Notfall-Modus** (Kontext voll / prompt-too-long): Reads ueberspringen,
nur aus In-Context Memory destillieren, direkt zu Schritt 3.

---

## Schritte

### Schritt 0: Datum holen

```bash
date +"%Y-%m-%d %H:%M"
```

### Schritt 1: Stand lesen (parallel, im Notfall ueberspringen)

Lies gleichzeitig:
- `.claude/memory.md`
- Heutige Daily Note aus `daily-notes/`

### Schritt 2: Session destillieren (aus In-Context Memory)

Extrahiere und komprimiere mit **wiederherstellbarer Kompression** —
bewahre Abruf-Pfade damit die naechste Session den vollen Kontext
wiederherstellen kann:

1. **Aufgabe** — ein Satz
2. **Erledigt/Offen** — 2-4 Punkte, Ergebnisse nicht Prozess
3. **Entscheidungen** — eine Zeile pro Stueck, WAS+WARUM nicht WIE
4. **Learnings** — Regeln/Fakten fuer Knowledge-Nominations
5. **Beruehrte Dateien** — volle Pfade aller gelesenen UND geaenderten Dateien
   (nicht nur geaenderte — auch wichtige gelesene Dateien die Entscheidungen
   beeinflusst haben). Das sind Abruf-Anker fuer die naechste Session.
6. **Aktive Referenzen** — URLs, API-Endpoints, externe Ressourcen.
   Inhalte weglassen, nur Zeiger behalten.
7. **Naechste Aktion** — praezise, ausfuehrbare Anweisung inklusive
   welche Datei(en) zuerst gelesen werden sollen

### Schritt 3: Handoff in Daily Note schreiben

Anhaengen (oder neue Daily Note erstellen wenn keine existiert):

```markdown
## Session-Handoff — [Uhrzeit]

**Aufgabe:** [ein Satz]
**Erledigt:** [Punkte]
**Offen:** [Punkte]
**Entscheidungen:** [Punkte]
**Dateien:** [volle Pfade — geaenderte und wichtige gelesene]
**Refs:** [URLs, externe Ressourcen — nur Zeiger, keine Inhalte]
**Naechste Aktion:** [praezise Aktion + welche Datei(en) zuerst lesen]
```

### Schritt 4: Memory.md aktualisieren (nur wenn geaendert)

Neue Prioritaeten, Threads, Entscheidungen → editieren.
Nichts geaendert → ueberspringen.

### Schritt 5: Learnings promoten und nominieren (nur wenn entdeckt)

**Tier 1: Direkte Promotion zu knowledge-base.md** (hohe Konfidenz):
- User-Overrides (explizit korrigierte Dinge)
- Empirische Fakten (durch Tests oder Daten verifiziert)

Direkt schreiben mit `[Source: User-Anweisung DATUM]` oder `[Source: Empirisch DATUM]`.

**Tier 2: Nominierung zu knowledge-nominations.md** (niedrigere Konfidenz):
- Agent-Inferenzen (beobachtete Patterns, nicht bestaetigt)
- Hypothesen (scheinen wahr, brauchen mehr Evidenz)

**Regel: Im Zweifel promoten. Eine Regel in knowledge-base.md die spaeter
korrigiert wird ist besser als eine Regel in Nominations die nie gesehen wird.**

### Schritt 6: Auto-Resume (wiederherstellbare Dekompression)

KEINEN Wiederaufnahme-Prompt ausgeben. Den User NICHTS fragen. Stattdessen:

1. `.claude/memory.md` und `.claude/knowledge-base.md` neu lesen
2. Den gerade geschriebenen Daily-Note-Handoff neu lesen
3. **Aus Abruf-Ankern wiederherstellen** — die Datei(en) aus dem **Naechste Aktion**
   Feld und kritische Dateien aus der **Dateien** Liste neu lesen
4. **Sofort die naechste Aktion ausfuehren** — genau da weitermachen wo aufgehoert wurde

Der User sollte eine kurze Pause erleben, dann geht die Arbeit nahtlos weiter.

Ziel: 5-7 Tool-Calls, <30 Sekunden. Notfall: 2-3 Calls, <15 Sekunden.

## Wichtig
- MUST: Nahtlos weitermachen — keine "Clearing" oder "Resuming" Nachrichten
- MUST: Alle Abruf-Pfade (Dateien, Refs) bewahren
- MUST: Im Notfall-Modus maximal 3 Tool-Calls
- MUST: Learnings sichern bevor Kontext verloren geht
