# Standard Project File Structure

After Cortex installation, a project should have this structure:

```
project-root/
├── CLAUDE.md                     ← Project rules (merged with Cortex template)
├── CLAUDE.local.md               ← Personal overrides (gitignored)
├── .claude-template.json         ← Version tracking manifest
├── .claude/
│   ├── settings.json             ← Hooks + permissions (merged)
│   ├── settings.local.json       ← Personal settings (gitignored)
│   ├── agents/                   ← 14 agent definitions
│   ├── commands/                 ← 11 slash commands
│   ├── skills/                   ← 8+ skills
│   ├── rules/                    ← 11 rule files
│   ├── knowledge-base.md         ← Approved learnings
│   ├── knowledge-nominations.md  ← Pending learnings
│   ├── team-learnings.json       ← Team sync via git
│   └── logs/                     ← Session logs (gitignored)
├── scripts/
│   ├── hooks/                    ← 20+ hook scripts
│   ├── db/                       ← SQLite learning database
│   ├── bot/                      ← Telegram notifications
│   └── template/                 ← Install/update/merge scripts
├── .env.example                  ← Environment variable template
├── .mcp.json.example             ← MCP server config template
└── .gitignore                    ← Includes Cortex entries
```

## Key Ownership Rules

- **Template-owned** (updated by Cortex): rules/, agents/, commands/, skills/, hooks/, db/
- **Project-owned** (never overwritten): CLAUDE.local.md, knowledge-base.md, .mcp.json
- **Merge files** (smartly merged): CLAUDE.md, settings.json, team-learnings.json
