# Active Session Context

## Now
- Telegram Team Bot is live on master (45 commits merged)
- Worker: cortex-team-bot.twilight-resonance-f2fc.workers.dev
- Bot: @ClaudeCortexBot in Login & Information Channel + Claude Cortex Starter Template Group
- 43 GitHub Issues open (30 Skills Rework, 5 Testing, 6 Infra, 2 i18n)
- gws CLI authenticated (Gmail, Calendar, Drive, Sheets, Docs)

## Open Threads
- Phase 5 (Coolify/Hetzner Deploy Tracking) — waiting for Hetzner setup
- Skills Rework with Skill Creator (30 issues, #1-#30)
- i18n: Translate MD files to English (#36, #37)
- Group restructuring: Separate Telegram groups per project (design ready, not yet implemented)

## Recent Decisions
- grammy instead of raw Telegram API (professional, middleware pattern)
- D1 SQLite for history/analytics (KV only for fast access)
- KV TTL for sessions instead of explicit end-event (prevents false offline on context compression)
- Separate Login Channel + Project Groups instead of forum topics in one group
- All messages in English (international team)
- Hetzner + Coolify for deployments (not set up yet)

## Blockers
- Hetzner/Coolify not set up yet (Phase 5 blocked)
