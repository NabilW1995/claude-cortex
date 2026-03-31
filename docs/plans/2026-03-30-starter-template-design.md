# Claude Starter Team Template — Design Document

## Datum: 2026-03-30

## Übersicht
Ein Meta-Template das bei jedem neuen Projekt als Basis dient. Enthält:
- Project Discovery (10-20 Fragen Interview)
- Scaffolding (70+ Projekt-Typen)
- SQLite Lernsystem (projekt-übergreifend)
- 6 spezialisierte Agents
- 15 automatische Hooks
- Enterprise Testing-Pyramide

## Quellen
- TheDecipherist/claude-code-mastery (Basis-Struktur)
- rohitg00/pro-workflow (SQLite Learning System)
- affaan-m/everything-claude-code (Instinkt-System Konzepte)
- Claudify (Agents, Memory-Architektur, Knowledge-Promotion)
- interview-me (Discovery Skill Konzept)
- Claude-Code-Scaffolding-Skill (70+ Projekt-Typen)

## Architektur-Entscheidungen
1. SQLite statt JSON für Learnings → portabel, queryable, projekt-übergreifend
2. FTS5 für Suche → BM25-Ranking, relevante Ergebnisse
3. Knowledge-Promotion Pipeline → Qualitätssicherung durch Auditor
4. Deutsche + Englische Pattern-Erkennung → natürliche Konversation
5. Implizites Learning ("Perfekt!"-Trigger) statt expliziter Tags

## Komponenten
- 1 CLAUDE.md (Hauptregeln)
- 9 Commands
- 3 Skills (Discovery, Scaffolding, Learning)
- 6 Agents (Auditor, Unsticker, Error-Whisperer, Yak-Shave, Sherpa, PR-Ghost)
- 6 Rules (Non-Programmer, Web-Dev, Security, Git, A11y, Sanitization)
- 15 Hooks
- SQLite DB mit FTS5
- Knowledge-Promotion Pipeline
