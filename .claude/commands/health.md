Health check — verify Cortex is correctly installed and configured.

## Steps

### 1. Check Agents
Count files in `.claude/agents/`. Expected: 8.
List each agent and verify the file exists.

### 2. Check Hooks
Verify these critical hooks exist in `scripts/hooks/`:
- guard-bash.sh
- security-scan.sh
- post-edit-lint.sh
- auto-test.sh
- session-start.js
- session-end.js
- prompt-submit.js
- heartbeat.js

Also verify they are configured in `.claude/settings.json`.

### 3. Check Learning DB
Run: `node -e "const {getDb}=require('./scripts/db/store');(async()=>{const db=await getDb();const c=db.exec('SELECT COUNT(*) FROM learnings');console.log(c[0].values[0][0]+' learnings');db.close()})().catch(()=>console.log('NOT INITIALIZED'))"`

### 4. Check .env
Compare `.env` against `.env.example`. Report missing variables.

### 5. Check Git
- Current branch
- Uncommitted changes count
- Remote configured?

### 6. Check Telegram (if configured)
If TELEGRAM_BOT_TOKEN is in .env, test the bot:
```bash
node -e "const {loadBotConfig}=require('./scripts/bot/notify');const c=loadBotConfig('.');console.log(c?'Configured':'Not configured')"
```

### 7. Check Worker (if configured)
If CORTEX_WORKER_URL is in .env, ping the health endpoint.

### 8. Output Format

```
🧠 Cortex Health Check
━━━━━━━━━━━━━━━━━━━━━

Agents:      8/8 ✓
Hooks:       8/8 ✓
Learning DB: 42 learnings, 8 rules ✓
.env:        all vars set ✓
Git:         branch feature/auth, 3 uncommitted ⚠️
Telegram:    connected ✓
Worker:      responding ✓

Status: HEALTHY (1 warning)
```

Use ✓ for pass, ⚠️ for warning, ✗ for fail.
