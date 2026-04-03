---
description: Code quality standards - style matching, DRY, TypeScript, error handling
globs: "**/*.{js,ts,tsx,jsx,py,sh}"
---

# Code Quality

- Match the existing style of the repo — even if it's not perfect
- Check if logic already exists before writing new code (DRY)
- Simple functions with a single purpose — no multi-mode functions
- TypeScript strict mode when TS is used — no `any` type
- Throw errors explicitly — never silently swallow them
- Error messages: clear, actionable, with context (what went wrong, where, why)
- No generic catch-all exception handlers
