# Skill Definitions

Skills are configurable, preloadable capabilities. They live in subdirectories with a SKILL.md file.

## Frontmatter Fields (13 available)

| Field | Type | Purpose |
|-------|------|---------|
| `name` | string | Display name and /slash-command identifier |
| `description` | string | **TRIGGER, not summary** — tells the model WHEN to invoke |
| `user-invocable` | boolean | false = hidden from / menu (agent-only skill) |
| `context` | string | "fork" = runs in isolated subagent context |
| `agent` | string | Subagent type when context: fork |
| `allowed-tools` | string | Tools auto-allowed when skill is active |
| `model` | string | Model override (haiku, sonnet, opus) |
| `effort` | string | Effort override (low, medium, high, max) |
| `hooks` | object | On-demand hooks (active only while skill runs) |
| `paths` | string/list | Glob patterns limiting auto-activation |
| `argument-hint` | string | Autocomplete hint (e.g., [issue-number]) |
| `disable-model-invocation` | boolean | Prevent automatic invocation |
| `shell` | string | bash (default) or powershell |

## Critical Rules
- **description is for the MODEL** — write WHEN to trigger, not what it does
- Every skill MUST have a `## Gotchas` section with known failure points
- Use `context: fork` for skills that generate lots of intermediate output
- Use `user-invocable: false` for agent-only domain knowledge skills
- Skills are FOLDERS — use references/, examples/, scripts/ subdirectories for progressive disclosure
- The `allowed-tools` field auto-approves tools without permission prompts
