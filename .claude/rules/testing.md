---
description: Testing strategy - test pyramid, testing rules
globs: "**/*.{test,spec}.{ts,tsx,js,jsx,py}"
---

# Testing Strategy (Pyramid)

## Unit Tests (Base — many, fast)
- Every function that contains logic needs a unit test
- Test: Correct input, incorrect input, edge cases
- Framework: Vitest (JS/TS) or pytest (Python)

## Integration Tests (Middle — some)
- Every API endpoint needs an integration test
- Test: Request — Response, database operations, auth flow
- External APIs are mocked

## E2E Tests (Top — few, critical flows)
- Login/Registration
- Payment/Checkout (if applicable)
- The 3 most important user journeys
- See @.claude/rules/browser-use.md for Browser Use CLI commands.

## Testing Rules
- MUST: Write tests alongside code (code and tests are developed together)
- MUST: Every new feature needs at least unit tests
- MUST: Every bugfix needs a regression test ("Prove the bug is fixed")
- MUST: Run tests before every commit
- MUST: At least 80% code coverage for new code
- NEVER: Call code "done" without passing tests
