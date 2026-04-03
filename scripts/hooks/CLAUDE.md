# Hooks Directory

These hooks run automatically during Claude Code sessions. They are registered in `.claude/settings.json`.

## Our Active Hook Events (10 of 22)

| Event | Scripts | When |
|-------|---------|------|
| **UserPromptSubmit** | prompt-submit.js, tdd-reminder.js | Every user message |
| **PreToolUse (Bash)** | guard-bash.sh, test-existence-check.sh, sync-check.js | Before bash commands |
| **PreToolUse (Write/Edit)** | backup-before-write.sh, completeness-gate.sh | Before file changes |
| **PostToolUse (Write/Edit)** | post-edit-lint.sh, security-scan.sh, log-changes.sh, auto-test.sh | After file changes |
| **PostToolUseFailure** | log-failures.sh | After a tool fails |
| **PreCompact** | pre-compact.sh | Before context compression |
| **PostCompact** | post-compact-resume.sh | After context compression |
| **SessionStart** | session-reset.sh, session-start.js, sync-check.js, sync-team-learnings.js | Session begins |
| **SessionEnd** | session-end.js, auto-push-learnings.js | Session closes |
| **Stop** | stop-prompts.js, session-end.js, log-stop-verdict.sh, auto-push-learnings.js | Claude stops |
| **TaskCompleted** | Telegram notification (async) | Background task finishes |

## All 22 Claude Code Hook Events (Reference)

| Event | Available | We Use | Purpose |
|-------|-----------|--------|---------|
| UserPromptSubmit | Yes | Yes | Fires on every user message |
| PreToolUse | Yes | Yes | Before any tool executes (matcher: Bash, Write, Edit, etc.) |
| PostToolUse | Yes | Yes | After tool succeeds |
| PostToolUseFailure | Yes | Yes | After tool fails |
| PreCompact | Yes | Yes | Before context window compression |
| PostCompact | Yes | Yes | After compression — restore important context |
| SessionStart | Yes | Yes | Session begins — load state, check env |
| SessionEnd | Yes | Yes | Session closes cleanly — save state |
| Stop | Yes | Yes | Claude decides to stop — show prompts, log |
| TaskCompleted | Yes | Yes | Background task finishes — notify |
| Notification | Yes | No | Model wants to notify user |
| PermissionRequest | Yes | No | Route permission prompts to Slack/Telegram |
| SubagentStart | Yes | No | Subagent spawned |
| SubagentStop | Yes | No | Subagent finished |
| Setup | Yes | No | One-time setup (30s timeout) |
| TeammateIdle | Yes | No | Agent team member idle |
| ConfigChange | Yes | No | Settings modified |
| WorktreeCreate | Yes | No | Git worktree created |
| WorktreeRemove | Yes | No | Git worktree removed |
| InstructionsLoaded | Yes | No | CLAUDE.md loaded |
| Elicitation | Yes | No | Claude asks user a question |
| ElicitationResult | Yes | No | User answers question |

## Hook Types (4 available)

| Type | What it does | We use |
|------|-------------|--------|
| `command` | Runs a shell command | Yes (all our hooks) |
| `prompt` | Single-turn model evaluation (yes/no) | No |
| `agent` | Multi-turn subagent with Read/Grep/Glob | No |
| `http` | POSTs JSON to a URL | No |

## Rules
- Hooks MUST NOT block — use `async: true` and `timeout: 5000` max
- Always exit 0 even on error — a failing hook should never crash the session
- stderr output is visible to Claude, stdout is parsed as JSON control signals
- Test hooks manually: `node scripts/hooks/hook-name.js` or `bash scripts/hooks/hook-name.sh`
- Hooks receive JSON on stdin: `hook_event_name`, `session_id`, `cwd`, `transcript_path`

## File Conventions
- `.sh` files: Bash hooks (cross-platform, POSIX syntax)
- `.js` files: Node.js hooks (complex logic, DB access, HTTP calls)
