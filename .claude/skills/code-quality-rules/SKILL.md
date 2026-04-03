---
name: code-quality-rules
description: "Domain knowledge about this project's code patterns and conventions. Preloaded into coder agent — never invoke directly."
user-invocable: false
---

# Code Quality Rules

This skill is preloaded into the `core--coder` agent via the `skills:` frontmatter field. It provides domain knowledge about coding patterns and conventions used in this project.

## Code Patterns

- Match the existing style of the repo — consistency over perfection
- Check if logic already exists before writing new code (DRY)
- Simple functions with a single purpose — no multi-mode functions
- TypeScript strict mode when TS is used — no `any` type
- Throw errors explicitly — never silently swallow them
- Error messages: clear, actionable, with context (what went wrong, where, why)

## Naming Conventions

- Files: kebab-case (e.g., `merge-settings.js`, `session-start.js`)
- Functions: camelCase (e.g., `getAllFiles`, `mergeCLAUDEmd`)
- Constants: UPPER_SNAKE_CASE (e.g., `TEMPLATE_DIR`, `CACHE_MAX_AGE_MS`)
- Agent files: `category--name.md` (e.g., `core--coder.md`)
- Branches: `feature/description` or `fix/description`

## Error Handling

- Always use try/catch for async operations and external calls
- Log errors to stderr (console.error) — Claude reads stderr
- Exit 0 from hooks even on error — never crash the session
- Include context in error messages: what was attempted, what failed, suggested fix

## Testing

- Every function with logic needs a unit test
- Tests live in `__tests__/` directories next to the code
- Use node:test + node:assert (built-in) or vitest
- Test pattern: create temp directory → run function → assert results → cleanup

## Security

- NEVER hardcode secrets — use environment variables
- Always parameterized queries for SQL (never string concatenation)
- Validate all user input (type, length, format)
- Use path.join() for file paths — never string concatenation

## Dynamic Context

Current project dependencies:
!`node -e "try{console.log(Object.keys(require('./package.json').dependencies||{}).join(', '))}catch(e){console.log('no package.json')}" 2>/dev/null`

Current branch:
!`git branch --show-current 2>/dev/null || echo "not in git repo"`

## Gotchas

- Windows uses backslashes — always use path.join(), never hardcode slashes
- The `postinstall` script runs during npx downloads too — guard with .claude-template.json check
- Hook scripts receive JSON on stdin — parse with JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'))
- merge-claude-md.js uses regex with CORTEX markers — test changes thoroughly
