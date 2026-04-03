# Agent Definitions

Agents are autonomous actors with their own isolated context window. They are defined as markdown files with YAML frontmatter.

## Frontmatter Fields (16 available)

| Field | Type | Purpose |
|-------|------|---------|
| `name` | string | Unique identifier (required) |
| `description` | string | When to invoke — use "PROACTIVELY" for auto-invocation |
| `model` | string | haiku, sonnet, opus, or inherit (default: inherit) |
| `memory` | string | Persistent memory: user, project, or local |
| `effort` | string | low, medium, high, max |
| `color` | string | CLI output color (blue, green, yellow, red, cyan, magenta, white) |
| `maxTurns` | integer | Maximum agentic turns before stopping |
| `skills` | list | Skill names to preload into agent context |
| `hooks` | object | Lifecycle hooks scoped to this agent |
| `permissionMode` | string | default, acceptEdits, plan, bypassPermissions |
| `tools` | string/list | Allowlist of tools (inherits all if omitted) |
| `disallowedTools` | string/list | Tools to deny |
| `background` | boolean | Always run as background task |
| `isolation` | string | "worktree" for isolated git worktree |
| `initialPrompt` | string | Auto-submitted as first user turn |
| `mcpServers` | list | MCP servers for this agent |

## Conventions for This Project
- Core agents (coder, test-runner, code-review) use `memory: project` to retain context
- Core agents use `effort: high` for thorough work
- Each agent has a distinct `color` for visual identification in terminal
- The `skills:` field preloads domain knowledge (e.g., coder gets code-quality-rules)
- Agent descriptions should explain WHEN to dispatch, not what the agent does
