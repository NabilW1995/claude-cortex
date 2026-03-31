---
description: Testing strategy - test pyramid, TDD rules, Browser Use for E2E
globs: "**/*.{test,spec}.{ts,tsx,js,jsx,py}"
---

# Testing-Strategie (Pyramide)

## Unit Tests (Basis — viele, schnell)
- Jede Funktion die Logik enthält braucht einen Unit Test
- Teste: Korrekte Eingabe, falsche Eingabe, Grenzfälle
- Framework: Vitest (JS/TS) oder pytest (Python)

## Integration Tests (Mitte — einige)
- Jeder API-Endpoint braucht einen Integration Test
- Teste: Request → Response, Datenbank-Operationen, Auth-Flow
- Externe APIs werden gemockt

## E2E Tests (Spitze — wenige, kritische Flows)
- Login/Registrierung
- Bezahlung/Checkout (wenn vorhanden)
- Die 3 wichtigsten User-Journeys
- Tool: Browser Use CLI (`browser-use`) — NICHT Playwright
- Visuelles Review: `browser-use screenshot` für Screenshots
- Interaktion: `browser-use open`, `browser-use click`, `browser-use input`, `browser-use state`

## Testing-Regeln
- MUST: Tests ZUERST schreiben, dann implementieren (TDD)
- MUST: Jedes neue Feature braucht mindestens Unit Tests
- MUST: Jeder Bugfix braucht einen Regressions-Test ("Beweise dass der Bug gefixt ist")
- MUST: Tests laufen lassen vor jedem Commit
- MUST: Mindestens 80% Code-Coverage für neuen Code
- NEVER: Code als "fertig" bezeichnen ohne laufende Tests
