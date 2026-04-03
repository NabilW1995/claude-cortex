---
description: "RPI Phase 1: Research. Use when starting a new feature to check feasibility. Produces a GO/NO-GO verdict before any planning or coding begins."
argument-hint: [feature description]
---

# RPI Research — Is This Feature Feasible?

## Step 1: Create Feature Directory

```bash
mkdir -p rpi/$FEATURE_SLUG/research
```

Replace $FEATURE_SLUG with a kebab-case version of the feature name (e.g., "user-auth", "payment-flow").

## Step 2: Parse Requirements

Dispatch the `requirement-parser` agent:
- Parse the feature request from `$ARGUMENTS`
- Output: `rpi/$FEATURE_SLUG/REQUEST.md`

## Step 3: Research in Parallel

Dispatch these agents in PARALLEL:

1. **pre--architect** (deep-dive) — Scan the codebase. What exists? What needs to change? What are the risks?
2. **Explore** (built-in) — Find related code, patterns, dependencies

While agents run, ask the user any Clarifying Questions from the requirement-parser output.

## Step 4: GO/NO-GO Verdict

Compile all findings into `rpi/$FEATURE_SLUG/research/RESEARCH.md`:

```markdown
# Research: [Feature Name]

## Summary
(2-3 sentences)

## Existing Code Analysis
(What already exists, what can be reused)

## Technical Feasibility
(Can we build this? What's the approach?)

## Risks
(What could go wrong?)

## Dependencies
(External APIs, libraries, services needed)

## Verdict: GO / NO-GO / CONDITIONAL GO / DEFER
(Clear decision with reasoning)
```

## Step 5: Present to User

Show the verdict and ask:
- **GO** → "Ready for /rpi-plan"
- **NO-GO** → Explain why, suggest alternatives
- **CONDITIONAL GO** → List conditions that must be met first
- **DEFER** → Add to backlog with reason
