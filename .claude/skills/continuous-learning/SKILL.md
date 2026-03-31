---
name: continuous-learning
description: Automatic learning system that detects corrections, extracts lessons, and builds a persistent knowledge base via SQLite
trigger: Runs via hooks on every session (session-start, prompt-submit, session-end)
---

# Continuous Learning System

## Übersicht
Ein dreistufiges Lernsystem das automatisch aus dem Gesprächsverlauf lernt. Keine manuellen Tags nötig — das System erkennt natürliche Konversationsmuster in Deutsch und Englisch.

## Stufe 1: Erkennung

### Korrektur-Patterns (prompt-submit.js)

**Deutsch — Korrekturen:**
nein, falsch, stimmt nicht, passt nicht, immer noch nicht, nicht richtig, anders, mach das nicht, stop, warte, rückgängig, zurück, funktioniert nicht, geht nicht, klappt nicht

**Englisch — Korrekturen:**
no, wrong, that's not right, incorrect, undo, revert, don't do that, stop, not working, still broken, try again, that didn't work

**Deutsch — Erfolg:**
perfekt, genau, funktioniert, super, passt, endlich, ja genau so, toll, sieht gut aus, stimmt jetzt, richtig so, jetzt geht's

**Englisch — Erfolg:**
perfect, exactly, works, great, nice, that's it, looks good, finally, correct, awesome

### Konversations-Analyse (session-end.js)
Am Ende jeder Session:
1. Finde Muster: Aufgabe → Fehlversuch(e) → Korrektur(en) → Lösung → Erfolg
2. Für jedes Muster extrahiere: Problem, Fehlversuche, finale Lösung
3. Kategorisiere: UI, Backend, Database, Auth, Styling, Testing, Git, etc.

### Task-relevante Learnings (prompt-submit.js)
Bei JEDEM neuen Prompt:
1. Keywords extrahieren (Stopwörter filtern)
2. FTS5-Suche in SQLite DB
3. Top 3-5 relevante Learnings an Claude übergeben

## Stufe 2: Speicherung (SQLite)

Datenbank: ~/.claude-learnings/learnings.db

**Tabelle: learnings**
- id, created_at, project, category
- rule (Was ist die Lektion?)
- mistake (Was wurde falsch gemacht?)
- correction (Was ist die richtige Lösung?)
- confidence (0.3 = unsicher, 0.9 = bestätigt)
- times_applied (Nutzungszähler)

**Tabelle: sessions**
- id, project, started_at, ended_at
- corrections_count, prompts_count

**Tabelle: nominations**
- id, learning_id, status (pending/approved/rejected)

**FTS5 Index** für Volltextsuche mit BM25-Ranking

## Stufe 3: Knowledge Promotion

### Nominations-Pipeline
1. Neues Learning → Status: pending
2. Auditor-Agent reviewed:
   - Korrekt? Allgemein genug? Widerspricht bestehenden Regeln?
3. Approved → knowledge-base.md mit [Source:] Tag
4. Rejected → confidence -= 0.1

### Cross-Project Promotion
- Learning in 2+ Projekten → confidence = 0.9 → Kandidat für globale Regel

### Confidence Decay
- >6 Monate nicht angewendet → confidence -= 0.1
- Unter 0.1 → automatisch archiviert
- Widerlegt → confidence = 0 → archiviert

## Regeln
- MUST: Learnings in einfacher Sprache speichern
- MUST: Immer Problem UND Lösung speichern
- MUST: Projekt-Tag für Cross-Projekt-Analyse
- NEVER: Sensitive Daten in Learnings
- NEVER: Mehr als 10 Learnings pro Session erzwingen
