---
name: sanity-check
description: "Use when user says 'check everything', 'does it fit together', 'production ready?', 'have we forgotten anything?', 'sanity check', 'passt alles zusammen?', 'alles checken'"
context: fork
allowed-tools: Read, Grep, Glob, Bash(npm test *), Bash(node --test *)
hooks:
  PreToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: prompt
          prompt: "Sanity check is READ-ONLY. BLOCK this write/edit operation. The sanity check should only READ and REPORT, never modify files."
---

# Sanity Check

A thorough project-wide verification that catches what humans miss. This skill runs in the current conversation — it sees everything that was discussed, planned, and built. It's the final safety net before shipping.

## When to Run

This skill activates when the user wants reassurance that everything is correct:
- "Haben wir irgendwas vergessen?"
- "Was könnten für Probleme auftreten?"
- "Können wir nochmal testen, dass alles passt?"
- "Ist das fertig?" / "Is this ready?"
- "Sanity check" / "Check mal alles"
- After completing a feature, before commit or PR

## Language

Ask the user which language they prefer for the report if not obvious from the conversation. Default to the language the user has been speaking.

## The 8-Point Check

Run ALL checks in order. For each, report a verdict: PASS / WARN / FAIL.

### 1. Auftrag vs. Ergebnis (Intent Match)

Go back to the ORIGINAL request the user made at the start of this task.

- What did they ask for?
- What did we actually build?
- Is there a gap between intent and result?
- Were requirements silently dropped or changed?

**How to check:** Re-read the user's original message. Compare each requirement point-by-point with what exists now. If the original request was vague, list what you interpreted and verify the user agrees.

### 2. Vergessene Dateien (Missing Files)

Scan for files that SHOULD exist but don't.

- Were new modules created but not exported/imported?
- Are there references to files that don't exist? (imports, requires, config paths)
- Were test files created for new code?
- Were documentation files updated? (README, CLAUDE.md, CHANGELOG)
- Does `.gitignore` cover new sensitive files?

**How to check:**
```
- Grep for import/require statements and verify targets exist
- Check if new functions/components have corresponding test files
- Verify all paths referenced in config files exist
```

### 3. Flow-Konsistenz (Logical Consistency)

Verify the overall architecture makes sense.

- Do all the pieces connect? (Frontend → API → Database → Response)
- Are there dead code paths or unreachable branches?
- Do error handlers actually handle the errors they claim to?
- Are there circular dependencies?
- Do naming conventions stay consistent across the change?
- **UI-Flow:** Are all buttons/links connected to actual handlers? Do onClick/onSubmit handlers exist?
- **Navigation:** Do all routes lead somewhere? Are there dead links or orphaned pages?
- **State-Flow:** Does data flow correctly between components? Are there state updates that never reach the UI?
- **User Journey:** Can the user complete every intended flow from start to finish without hitting a dead end?

**How to check:** Trace the data flow from user input to output. Follow every branch. Verify each function is called from somewhere. For UI: use `browser-use open` + `browser-use state` to verify all interactive elements are functional.

### 4. Kritische Risiken (Critical Risks)

Think adversarially — what could go wrong in production?

- **Security:** User input not validated? SQL injection? XSS? Hardcoded secrets?
- **Performance:** N+1 queries? Missing pagination? Unbounded loops? Large payloads without limits?
- **Concurrency:** Race conditions? Shared mutable state?
- **Edge cases:** Empty arrays? Null values? Unicode? Very long strings? Negative numbers?
- **Dependencies:** Are we relying on something that could fail? (External API, specific file path, network)

**How to check:** For each new function, ask "What happens if the input is null? Empty? Extremely large? Malicious?"

### 5. Offene TODOs und Lücken (Open Items)

Scan the entire changed codebase for unfinished work.

- `TODO`, `FIXME`, `HACK`, `XXX`, `TBD`, `PLACEHOLDER` comments
- Empty function bodies or stub implementations
- Commented-out code that should be removed or restored
- `console.log` / `print` debugging statements left in
- Hardcoded values that should be configurable

**How to check:**
```
Grep for: TODO|FIXME|HACK|XXX|TBD|PLACEHOLDER|console\.log|console\.debug
```

### 6. User-Schwierigkeiten (User Experience Risks)

Think from the perspective of someone using this for the first time.

- Is the setup process documented? Can someone new follow it?
- Are error messages helpful or cryptic?
- Are there silent failures that would confuse users?
- Is the UI/UX intuitive? (If applicable — use Browser Use CLI to verify)
- Are there accessibility issues? (Missing labels, poor contrast, keyboard navigation)

**How to check:** Mentally walk through the user journey step by step. For UI changes, use `browser-use open` and `browser-use screenshot` to visually verify.

### 7. Rules-Compliance (Project Standards)

Verify against the project's own rules.

- Read `.claude/rules/` — do all changes comply?
- Read `CLAUDE.md` — are the workflows followed?
- Read `.claude/knowledge-base.md` — are known lessons respected?
- Are there new learnings that should be saved to the SQLite DB?
- Does the code match existing patterns in the codebase?

**How to check:** Read each relevant rule file and verify compliance. Pay special attention to security.md, code-quality.md, and testing.md.

### 8. Tests & Build (Technical Verification)

Verify everything actually works.

- Do all existing tests still pass? (`npm run test`)
- Does the build succeed? (`npm run build`)
- Does linting pass? (`npm run lint`)
- Are there type errors? (`npx tsc --noEmit` if TypeScript)
- For UI changes: does it look correct? (`browser-use screenshot`)

**How to check:** Run the commands. If any fail, report the error and suggest a fix. If no test framework is set up, flag this as a WARN.

## Using Agents for Deep Checks

For complex checks, dispatch specialized agents:

- **core--code-review** — for deeper code quality analysis
- **fix--root-cause-finder** — if you find a suspicious bug during the check

Only dispatch agents when the check reveals something that needs deeper investigation. Simple checks (build, lint, types) should be done inline.

## Output Format

Present results clearly, for non-programmers:

```
## Sanity Check Report

### Zusammenfassung
[1-2 sentences: overall status]

| Check | Status | Details |
|-------|--------|---------|
| 1. Auftrag vs. Ergebnis | PASS/WARN/FAIL | [one line] |
| 2. Vergessene Dateien | PASS/WARN/FAIL | [one line] |
| 3. Flow-Konsistenz | PASS/WARN/FAIL | [one line] |
| 4. Kritische Risiken | PASS/WARN/FAIL | [one line] |
| 5. Offene TODOs | PASS/WARN/FAIL | [one line] |
| 6. User-Schwierigkeiten | PASS/WARN/FAIL | [one line] |
| 7. Rules-Compliance | PASS/WARN/FAIL | [one line] |
| 8. Tests & Build | PASS/WARN/FAIL | [one line] |

### Gefundene Probleme
[For each WARN or FAIL, explain in simple language:
- What's wrong
- Why it matters
- How to fix it]

### Was gut ist
[2-3 things that are done well — positive reinforcement]

### Empfehlung
[Clear recommendation: "Ready to ship" / "Fix these N issues first" / "Needs more work"]
```

## Rules

- Run ALL 8 checks — don't skip any, even if you think they'll pass
- Be specific: "security.md says validate all inputs, but `handleUpload()` at line 45 doesn't" — not "some security rules might not be followed"
- Don't cry wolf: only flag real issues, not theoretical edge cases that can't happen
- For WARN/FAIL items, always include a concrete fix suggestion
- If you're unsure about something, say so — don't guess
- The goal is confidence: after this check, the user should feel safe shipping

## Dynamic Context

Current branch:
!`git branch --show-current 2>/dev/null || echo "not in git repo"`

Uncommitted changes:
!`git status --short 2>/dev/null | head -10`

## Gotchas

- Large repos may hit context limits — use context:fork to run in isolation
- Check both code AND configuration (.env.example, .gitignore, CLAUDE.md)
- Don't just check syntax — verify that features actually connect end-to-end
- Always check for hardcoded secrets, even in test files
