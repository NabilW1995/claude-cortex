---
description: "RPI Phase 2: Plan. Use after research phase got GO verdict. Creates detailed implementation plan with user stories, UX flows, and tech architecture."
argument-hint: [feature name from research phase]
---

# RPI Plan — How Do We Build This?

Requires: Research phase completed with GO or CONDITIONAL GO verdict.

## Step 1: Read Research

Read `rpi/$FEATURE_SLUG/REQUEST.md` and `rpi/$FEATURE_SLUG/research/RESEARCH.md` for context.

## Step 2: Create Plan Directory

```bash
mkdir -p rpi/$FEATURE_SLUG/plan
```

## Step 3: Dispatch Agents in Parallel

Launch ALL THREE simultaneously:

1. **product-manager** agent — Creates `rpi/$FEATURE_SLUG/plan/pm.md` (user stories, acceptance criteria, scope)
2. **ux-designer** agent — Creates `rpi/$FEATURE_SLUG/plan/ux.md` (UI flows, wireframes, accessibility)
3. **pre--architect** (deep-dive) agent — Creates `rpi/$FEATURE_SLUG/plan/eng.md` (technical architecture, schema, API design)

Give each agent the REQUEST.md and RESEARCH.md as context.

## Step 4: Compile PLAN.md

After all 3 agents finish, compile their outputs into `rpi/$FEATURE_SLUG/plan/PLAN.md`:

```markdown
# Plan: [Feature Name]

## Phase 1: [Foundation]
- Task 1.1: ...
- Task 1.2: ...
- Test-Gate: [what must pass before Phase 2]

## Phase 2: [Core Logic]
- Task 2.1: ...
- Task 2.2: ...
- Test-Gate: [what must pass before Phase 3]

## Phase 3: [Polish + Integration]
- Task 3.1: ...
- Test-Gate: [final acceptance criteria]
```

Each phase must have:
- Concrete tasks (not vague)
- Test-Gate (what must pass to proceed)
- Estimated complexity (S/M/L)

## Step 5: Present to User

Show the complete plan (pm.md + ux.md + eng.md + PLAN.md) and ask for approval.
After approval → "Ready for /rpi-implement"
