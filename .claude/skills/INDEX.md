# Skills

> 8 skills that trigger automatically based on what you say.

## Available Skills

| Skill | Triggers on | Description |
|-------|------------|-------------|
| [browser-use](./browser-use/) | "test in browser", "screenshot", "visual review" | Browser automation for E2E testing and visual verification |
| [code-quality-rules](./code-quality-rules/) | *(preloaded into coder agent)* | Project code patterns and conventions |
| [continuous-learning](./continuous-learning/) | Corrections and confirmations | Detects mistakes, saves learnings, builds knowledge base |
| [frontend-design](./frontend-design/) | "build me a page", "design", "UI" | Production-grade frontend interfaces |
| [project-discovery](./project-discovery/) | "new project", "neues Projekt" | Interview process before building |
| [sanity-check](./sanity-check/) | "check everything", "production ready?" | Verifies consistency, completeness, production-readiness |
| [scaffolding](./scaffolding/) | "set it up", "scaffold", "erstelle Projekt" | Sets up new projects with Cortex pre-installed |
| [ui-ux-pro-max](./ui-ux-pro-max/) | "colors", "fonts", "how should this look?" | 67 styles, 96 palettes, 57 font pairings |

## How Skills Work

- Skills trigger **automatically** when Claude recognizes a relevant task
- Each skill has a `description` field that tells Claude **when** to invoke it
- Skills can run in isolated context (`context: fork`) to keep the main conversation clean
- Skills can be hidden from the `/` menu (`user-invocable: false`) for agent-only use
- Skills live in folders with optional `references/` and `examples/` subdirectories
