# [Projektname]
[Einzeilige Beschreibung — wird beim Setup ausgefüllt]

<!-- CORTEX:WICHTIG:START -->
## WICHTIG (Top 3 Regeln)
- MUST: Erkläre jede Änderung in einfacher, nicht-technischer Sprache
- MUST: Frag bevor du Dateien löschst oder Features entfernst
- MUST: Teste bevor du sagst dass du fertig bist
<!-- CORTEX:WICHTIG:END -->

<!-- CORTEX:ROUTING:START -->
## Skill-Routing (MUST follow)

| User sagt... | Aktion |
|---|---|
| UI/Design/Seite/Website bauen | → Design-Flow starten (@.claude/rules/design-flow.md) |
| "Neues Projekt starten" | project-discovery → scaffolding |
| "Welche Farben/Fonts/Style?" | ui-ux-guide |
<!-- CORTEX:ROUTING:END -->

## Commands
`npm run dev` · `npm run build` · `npm run test` · `npm run lint`

<!-- CORTEX:KOMMUNIKATION:START -->
## Kommunikation (Nicht-Programmierer)
- Erkläre JEDE Code-Änderung in 3-5 einfachen Sätzen: Was + Warum
- Nutze Analogien für technische Konzepte
- Bei fehlenden Informationen: FRAG bevor du Annahmen triffst
- Vor Breaking Changes: Warnung + explizite Bestätigung abwarten
<!-- CORTEX:KOMMUNIKATION:END -->

<!-- CORTEX:WORKFLOW:START -->
## Workflow
- MUST: Plan zeigen und auf Genehmigung warten bevor Code geschrieben wird
- MUST: Kleine, testbare Schritte — nicht 20 Dateien auf einmal
- MUST: Git-Commit nach jeder sinnvollen Änderung
- MUST: `npm run lint` und `npm run test` vor jedem Commit
- Branch-Naming: feature/beschreibung, fix/beschreibung
- Commit-Messages: <typ>: <beschreibung> (feat, fix, refactor, docs, test, chore)
<!-- CORTEX:WORKFLOW:END -->

<!-- CORTEX:GIT:START -->
## Git-Workflow
- NEVER: Direkt auf main/master committen — immer Feature-Branches
- NEVER: Force push — zerstört shared History
- MUST: Checkpoint-Commit vor großen Refactors
- MUST: `git diff` reviewen vor dem Commit — prüfe auf hardcoded Values und Secrets
<!-- CORTEX:GIT:END -->

## Projekt-Struktur
[Wird beim Scaffolding automatisch ausgefüllt]

## Gotchas
[Wird über die Zeit durch das Lernsystem gefüllt]

<!-- CORTEX:SETUP:START -->
## Setup (Erstinstallation)

Cortex zu einem bestehenden Projekt hinzufügen:
```bash
git clone --depth 1 https://github.com/NabilW1995/claude-cortex.git .cortex-temp && node .cortex-temp/scripts/template/install.js . && rm -rf .cortex-temp
```

Nach der Installation:
```bash
npm install                                    # Dependencies
npm run db:init                                # Learning-Datenbank
browser-use install && browser-use doctor      # Browser Use CLI (optional)
```

Cortex updaten:
```bash
npm run cortex:update
```
<!-- CORTEX:SETUP:END -->

<!-- CORTEX:REFS:START -->
## Reference Documents (Detail-Regeln)
@.claude/rules/design-flow.md — Design-Workflow: Stitch vs Lokal, Schritt-für-Schritt
@.claude/rules/browser-use.md — Browser Use CLI Commands & Regeln
@.claude/rules/testing.md — Testing-Pyramide, TDD, E2E mit Browser Use
@.claude/rules/lernsystem.md — Korrektur-Erkennung, Learning-Extraktion, Zweisprachig
@.claude/rules/sub-agent-regeln.md — Was Sub-Agents dürfen und nicht dürfen
@.claude/rules/code-quality.md — Code-Qualitätsstandards
@.claude/rules/non-programmer.md — Ausführliche Kommunikationsregeln
@.claude/rules/web-development.md — Frontend + Backend Patterns
@.claude/rules/security.md — Sicherheits-Checkliste
@.claude/rules/git-workflow.md — Git Best Practices
@.claude/rules/accessibility.md — Barrierefreiheit
@.claude/rules/input-sanitization.md — XSS, CSRF, SQL Injection Prevention
<!-- CORTEX:REFS:END -->

<!-- CORTEX:WICHTIG_REPEAT:START -->
## WICHTIG (Wiederholung)
- MUST: Erkläre jede Änderung in einfacher, nicht-technischer Sprache
- MUST: Frag bevor du Dateien löschst oder Features entfernst
- MUST: Teste bevor du sagst dass du fertig bist
<!-- CORTEX:WICHTIG_REPEAT:END -->
