# Telegram Bot Worker

Cloudflare Worker serving as the Telegram bot backend for team coordination.

## Tech Stack
- **Runtime**: Cloudflare Workers (serverless edge)
- **Bot Framework**: grammy (Telegram Bot API)
- **Database**: Cloudflare D1 (SQL, defined in schema.sql)
- **Storage**: Cloudflare KV (key-value, for sessions and state)
- **Config**: wrangler.toml

## Architecture
- `src/index.ts` is a single-file monolith (~3800 lines) — handle with care
- All Telegram commands, GitHub webhooks, sessions, dashboard, and cron jobs in one file
- Changes should be tested locally first: `npx wrangler dev`
- Deploy: `npx wrangler deploy`

## Key Features
- Session tracking (online/offline detection)
- GitHub issue integration (/tasks, /new, /done, /grab)
- Review queue and stale PR alerts
- Weekly reports and milestone tracking
- Interactive keyboard buttons for reviews

## Caution
- This file is large — read relevant sections before editing
- D1 bindings are defined in wrangler.toml, not in code
- KV namespace bindings also in wrangler.toml
- Bot token is in environment variables, never hardcode
