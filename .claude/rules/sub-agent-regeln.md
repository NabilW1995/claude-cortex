---
description: Rules for sub-agents - what they can and cannot do, design restrictions, hook compliance
---

# Sub-Agent Regeln

## Was Sub-Agents NICHT dürfen
- NEVER: UI/Design-Arbeit — Sub-Agents können keine Bilder/Screenshots sehen
- NEVER: Design-Entscheidungen treffen
- NEVER: UI-Komponenten gestalten
- NEVER: Visuelle Qualität prüfen

## Was Sub-Agents dürfen
- Code schreiben (Backend, Logik, Utils)
- Tests laufen lassen
- Recherche und Datei-Operationen
- Refactoring ohne visuelle Auswirkungen

## Visuelles Review
- Wenn ein Sub-Agent Code für UI schreibt: Main-Agent MUSS das Ergebnis visuell prüfen
- Main-Agent nutzt `browser-use screenshot` für visuelles Review
- Erst nach visuellem OK gilt die Arbeit als fertig

## Compliance
- MUST: Sub-Agents befolgen die gleichen Regeln aus CLAUDE.md (Sicherheit, Code-Qualität, Git)
- MUST: Hooks gelten auch für Sub-Agents — sie laufen im gleichen Projekt-Kontext
