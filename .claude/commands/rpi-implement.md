---
description: "RPI Phase 3: Implement. Use after plan phase is approved. Executes the plan phase by phase with test-gates and user approval after each phase."
argument-hint: [feature name or --phase N to resume]
---

# RPI Implement — Build It Phase by Phase

Requires: Plan phase completed and approved by user.

## Step 1: Read Plan

Read `rpi/$FEATURE_SLUG/plan/PLAN.md` to get the phases and tasks.

```bash
mkdir -p rpi/$FEATURE_SLUG/implement
```

## Step 2: Ask Implementation Strategy

Use AskUserQuestion:
- **Agent Teams** — Parallel teammates (for large phases with independent tasks)
- **Pipeline** — Sequential Coder → Test → Review (standard quality flow)

## Step 3: Execute Phase by Phase

For EACH phase in PLAN.md:

### 3a. Implement
- Dispatch core--coder (or Agent Teams if chosen) with the phase's tasks
- Reference pm.md for acceptance criteria
- Reference ux.md for UI requirements
- Reference eng.md for technical approach

### 3b. Test
- Dispatch core--test-runner after implementation
- Run ALL tests, not just new ones
- Check against the phase's Test-Gate

### 3c. Review
- Dispatch core--code-review for quality check

### 3d. Validate
- Run /sanity-check (replaces Boris' constitutional-validator)

### 3e. User Gate (MANDATORY)
- Present results to user
- Show: what was built, tests passing, review findings
- Ask: **PASS** (continue to next phase) or **FAIL** (fix issues first)

### 3f. Log Progress
- Update `rpi/$FEATURE_SLUG/implement/IMPLEMENT.md` with phase status

## Step 4: Completion

After all phases pass:
1. Final /sanity-check across everything
2. util--pr-writer creates PR description
3. Present summary to user

```markdown
# Implementation Complete: [Feature Name]

## Phases
- Phase 1: PASS
- Phase 2: PASS
- Phase 3: PASS

## Files Changed
(list)

## Tests
(count passing / total)

## Ready for PR
```

## Critical Rules

- MUST: Execute phases sequentially (never skip ahead)
- MUST: User must approve PASS after each phase (human-gated)
- MUST: All Test-Gates must pass before proceeding
- MUST: Run /sanity-check as final gate
- If a phase FAILS: fix issues, re-test, re-review, then re-ask user
