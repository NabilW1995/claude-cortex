---
description: Automatic agent routing - when to trigger which agent, how to dispatch as subagents
---

# Agent-Routing (MUST follow)

## Wie Agents gestartet werden

Agents werden als **Subagents** via dem Agent-Tool dispatcht. Der Main-Agent (Claude) liest die Agent-Definition aus `.claude/agents/{name}.md` und gibt sie als Prompt an den Subagent.

### Dispatch-Methode
```
Agent tool:
  subagent_type: "general-purpose"
  prompt: "Du bist der [Agent-Name] Agent. Folge den Anweisungen aus .claude/agents/[name].md.
           Lies zuerst die Agent-Definition, dann führe deine Aufgabe aus.

           Aufgabe: [konkrete Aufgabe]
           Kontext: [relevanter Kontext]"
```

### Parallel-Dispatch
Agents KÖNNEN parallel als mehrere Subagents dispatcht werden wenn die Aufgaben unabhängig sind:
- 3x coder-Agent für 3 unabhängige Features → gleichzeitig dispatchen
- coder + code-review → NICHT gleichzeitig (Review braucht fertigen Code)
- build-validator + env-validator → gleichzeitig (unabhängig voneinander)

### Wann Subagent, wann selbst?

| Komplexität | Methode | Beispiel |
|-------------|---------|----------|
| Klein (<10 Zeilen, einfacher Fix) | Claude selbst, aber Agent-Regeln befolgen | Typo fixen, Variable umbenennen |
| Mittel (10-50 Zeilen) | Claude selbst ODER Subagent — je nach Kontext | Funktion hinzufügen, Hook anpassen |
| Groß (50+ Zeilen, neues Feature) | MUST: Subagent dispatchen | Neues Modul, größeres Refactoring |
| Parallel (2+ unabhängige Tasks) | MUST: Subagents parallel dispatchen | 3 Features gleichzeitig |
| Review/Analyse | MUST: Subagent (frische Augen) | Code Review, Deep Dive, Audit |

### Regeln
- MUST: Bei großen Tasks (50+ Zeilen) → Subagent dispatchen
- MUST: Bei Reviews/Analysen → immer Subagent (frischer Kontext = bessere Qualität)
- MAY: Bei kleinen Änderungen → Claude darf selbst, aber befolgt die Agent-Regeln aus `.claude/agents/{name}.md`
- MUST: Die Agent-Definition als Basis-Prompt nutzen wenn Subagent dispatcht wird
- MUST: Konkreten Kontext mitgeben (welche Dateien, welcher Fehler, welche Aufgabe)
- MUST: Agent-Ergebnis dem User in einfacher Sprache zusammenfassen

---

## Wann welcher Agent automatisch laufen MUSS

### coder — Bei JEDER Coding-Aufgabe
- TRIGGER: Wenn ein neues Feature implementiert werden soll
- TRIGGER: Wenn bestehender Code refactored werden soll
- TRIGGER: Wenn der User sagt "Bau mir...", "Implementiere...", "Schreibe Code für..."
- TRIGGER: Wenn eine neue Komponente, Funktion oder Modul erstellt werden soll
- AKTION: 3-Phasen-Workflow: Recherche → Implementierung → Verifizierung
- MUST: Immer zuerst Codebase und Learnings-DB recherchieren
- MUST: Immer `npm run lint` und `npm run test` vor Abschluss ausführen
- PARALLEL: Mehrere coder-Agents können für unabhängige Tasks gleichzeitig laufen

### code-review — Nach Feature-Completion + vor PR
- TRIGGER: Wenn ein Feature fertig implementiert wurde
- TRIGGER: Wenn der User sagt "Review", "Prüfe den Code", "Ist das gut so?"
- TRIGGER: Vor dem Erstellen eines Pull Requests
- AKTION: 7-Kategorien-Review mit Schweregrad-Levels (CRITICAL, HIGH, MEDIUM, LOW)
- MUST: Issues in einfacher Sprache erklären
- MUST: Wiederkehrende Issues als Learning in der SQLite-DB speichern

### test-runner — Nach JEDEM Coding-Task (PFLICHT)
- TRIGGER: Nachdem der coder Agent fertig ist (Quality Gate)
- TRIGGER: Nach jedem Bugfix (Regressions-Test)
- TRIGGER: Wenn der User sagt "Teste das", "Laufen die Tests?"
- TRIGGER: Im TDD-Modus: VOR der Implementierung (Tests zuerst schreiben)
- AKTION: Unit Tests → Integration Tests → E2E Tests (Browser Use) → Coverage Report
- FORMAT: Einfache Zusammenfassung mit Ampel (✅/⚠️/❌)
- MUST: IMMER nach dem coder Agent laufen — kein Code ohne Tests
- MUST: Browser Use CLI für E2E Tests, NICHT Playwright
- PARALLEL: Kann gleichzeitig mit build-validator laufen

### build-validator — Nach Implementierung + vor Commit
- TRIGGER: Wenn eine Implementierung abgeschlossen wurde
- TRIGGER: Vor jedem Git-Commit
- TRIGGER: Nach großen Refactorings oder Merges
- AKTION: Build → Types → Lint (KEIN Testing — das macht test-runner)
- FORMAT: Ampel-System (BESTANDEN / WARNUNG / FEHLGESCHLAGEN)

### error-whisperer — Bei JEDER Fehlermeldung
- TRIGGER: Wenn ein Tool fehlschlägt oder eine Fehlermeldung erscheint
- TRIGGER: Wenn der User sagt "geht nicht", "Fehler", "Error"
- AKTION: Fehler übersetzen, Lösung zeigen, Ursache erklären
- MUST: NIEMALS rohe Fehlermeldungen an den User weitergeben

### debug-investigator — Bei spezifischen Fehlern/Bugs
- TRIGGER: Wenn ein spezifischer Fehler oder Bug untersucht werden muss
- TRIGGER: Wenn ein Test fehlschlägt und die Ursache unklar ist
- TRIGGER: Ergänzend zum error-whisperer wenn tiefere Analyse nötig ist
- AKTION: 5-Schritt-Untersuchung: Parsen → Lesen → Suchen → Git-History → Grundursache

### rubber-duck — Nach 3 Korrekturen + bei Denkblockade
- TRIGGER: Wenn der User 3x hintereinander korrigiert (prompt-submit.js streak == 3)
- TRIGGER: Wenn der User sagt "Ich weiß nicht wie", "Ich stecke fest", "Hilf mir denken"
- TRIGGER: Wenn der unsticker nach 2 Runden keine Lösung findet
- AKTION: Sokratisches Debugging — Fragen stellen statt Antworten geben
- MUST: Niemals direkt die Lösung geben

### unsticker — Nach 5 Korrekturen
- TRIGGER: Wenn der User 5x hintereinander korrigiert (prompt-submit.js streak >= 5)
- AKTION: Root-Cause-Analyse, Learnings-DB prüfen, einfachste Lösung zuerst
- Eskalations-Kette: Rubber Duck (3) → Unsticker (5)

### pr-ghostwriter — Vor JEDEM Pull Request
- TRIGGER: Wenn ein PR erstellt werden soll
- AKTION: Diff analysieren, PR-Beschreibung schreiben
- MUST: PR-Beschreibung vom Agent schreiben lassen, nicht selbst formulieren

### deep-dive — Bei gründlicher Analyse vor Entscheidungen
- TRIGGER: Wenn der User sagt "Analysiere...", "Untersuche...", "Was wäre der beste Ansatz?"
- TRIGGER: Wenn ein Implementierungsplan geprüft werden soll
- AKTION: 6-Phasen-Framework mit Executive Summary
- MUST: Gründlichkeit vor Geschwindigkeit

### archaeologist — Bei "Warum ist das so?"
- TRIGGER: Wenn der User fragt "Warum wurde das so gemacht?", "Ist es sicher das zu ändern?"
- AKTION: Git Blame + Commit-Archäologie, Sicherheits-Verdict

### debt-collector — Bei /debt-map + automatisch bei steigender Debt
- TRIGGER: Wenn User `/debt-map` aufruft
- TRIGGER: Automatisch wenn TODO/FIXME-Zähler >=20 UND steigend
- AKTION: Codebase scannen, Tech-Debt kategorisieren und priorisieren

### onboarding-sherpa — Bei Cortex-Installation + /onboard
- TRIGGER: Nach dem Install-Script oder wenn User `/onboard` aufruft
- AKTION: Codebase scannen und 1-Seite Briefing geben

### auditor — Bei /audit + nach Learning-Genehmigung
- TRIGGER: Wenn User `/audit` aufruft
- AKTION: Nominations reviewen, Knowledge-Base aktualisieren

### env-validator — Am Session-Start + vor Deploy
- TRIGGER: Am Beginn einer neuen Arbeitssession
- TRIGGER: Nach Cortex-Installation, vor Deployment
- AKTION: Umgebung prüfen (Vars, Tools, Dependencies, DB, Git)
- MUST: NIEMALS Secret-Werte anzeigen

### yak-shave-detector — Periodisch + bei Komprimierung
- TRIGGER: Vor Context-Komprimierung (PreCompact)
- TRIGGER: Wenn >10 Dateien in einer Session geändert wurden
- AKTION: Prüft ob aktuelle Arbeit noch zur Aufgabe passt

---

## Plugins (projektspezifisch installiert)

Plugins ergänzen unsere Agents. Sie werden über Skills/Commands aufgerufen.

### code-review Plugin — PR-Review auf GitHub
- TRIGGER: Wenn ein PR auf GitHub reviewed werden soll
- AUFRUF: `/code-review` oder Skill `code-review:code-review`
- UNTERSCHIED zu unserem code-review Agent: Plugin reviewt auf GitHub (mit `gh`), unser Agent reviewt lokal
- Workflow: Unser Agent für lokales Review → Plugin für PR-Review auf GitHub

### code-simplifier Plugin — Code vereinfachen
- TRIGGER: Nach Abschluss eines Features (vor PR)
- TRIGGER: Wenn der User sagt "Vereinfache den Code", "Mach es simpler", "Cleanup"
- TRIGGER: Nach größeren Refactorings
- AUFRUF: Skill `code-simplifier:code-simplifier` oder Agent `code-simplifier` dispatchen
- MUST: NACH dem code-review laufen lassen (erst prüfen, dann vereinfachen)

### feature-dev Plugin — Geführte Feature-Entwicklung
- TRIGGER: Wenn ein komplexes Feature gebaut werden soll mit Discovery-Phase
- TRIGGER: Wenn der User sagt "Bau ein Feature", "Neues Feature"
- AUFRUF: `/feature-dev` oder Skill `feature-dev:feature-dev`
- UNTERSCHIED zu unserem coder Agent: Plugin hat Discovery + Architecture Phase
- Workflow: feature-dev Plugin für komplexe Features, coder Agent für einfache Implementierung

### claude-md-management Plugin — CLAUDE.md pflegen
- TRIGGER: Nach Template-Update (`/template-update`)
- TRIGGER: Wenn der User sagt "Verbessere die CLAUDE.md", "Prüfe die CLAUDE.md"
- TRIGGER: Am Ende eines produktiven Arbeitstags (bei `/wrap-up`)
- AUFRUF: `/revise-claude-md` oder Skill `claude-md-management:claude-md-improver`
- MUST: Nach jedem Template-Update die CLAUDE.md prüfen und verbessern

### skill-creator Plugin — Neue Skills erstellen
- TRIGGER: Wenn der User einen neuen Skill erstellen will
- AUFRUF: Skill `skill-creator:skill-creator`

---

## Standard-Workflow: Feature bauen

Die typische Reihenfolge bei einem neuen Feature:

```
1. env-validator       → Umgebung OK?
2. feature-dev Plugin  → Discovery + Architecture (bei komplexen Features)
   ODER deep-dive      → Analyse (bei Architektur-Fragen)
3. coder               → Implementierung (ggf. mehrere parallel)
4. test-runner         → Tests schreiben + laufen lassen (PFLICHT!)
   + build-validator   → Build + Types + Lint (parallel zum test-runner)
5. code-review Agent   → Lokales Code-Review
6. code-simplifier     → Code vereinfachen (optional)
7. pr-ghostwriter      → PR-Beschreibung schreiben
8. code-review Plugin  → PR-Review auf GitHub
```

Bei Fehlern zwischendurch:
```
error-whisperer → debug-investigator → rubber-duck (3x) → unsticker (5x)
```

Am Ende des Tages:
```
claude-md-management → CLAUDE.md prüfen und verbessern
```
