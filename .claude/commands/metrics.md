Code metrics — show project health at a glance.

## Steps

### 1. Lines of Code

Count lines in source files (exclude node_modules, dist, .git):
```bash
find src/ lib/ app/ components/ -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" 2>/dev/null | xargs wc -l 2>/dev/null | tail -1
```

If no src/ directory, scan the project root for code files.

### 2. File Count

```bash
find . -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" | grep -v node_modules | grep -v dist | wc -l
```

### 3. Test Coverage

Check if a coverage report exists:
```bash
ls coverage/lcov-report/index.html 2>/dev/null || ls coverage/coverage-summary.json 2>/dev/null
```

If exists, parse and show percentage.
If not, suggest: "Run `npm run test -- --coverage` to generate a coverage report."

### 4. Complexity (Top 5 largest files)

```bash
find . -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" | grep -v node_modules | grep -v dist | xargs wc -l 2>/dev/null | sort -rn | head -6
```

Show files with >200 lines as warnings.

### 5. Dependencies

```bash
node -e "const p=require('./package.json'); const d=Object.keys(p.dependencies||{}); const dd=Object.keys(p.devDependencies||{}); console.log(d.length+' deps, '+dd.length+' devDeps')"
```

Check for outdated:
```bash
npm outdated --json 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(Object.keys(d).length+' outdated')"
```

### 6. Learnings

```bash
node -e "const {getDb}=require('./scripts/db/store');(async()=>{const db=await getDb();const l=db.exec('SELECT COUNT(*) FROM learnings');const r=db.exec('SELECT COUNT(*) FROM learnings WHERE confidence>=0.7');console.log(l[0].values[0][0]+' total, '+r[0].values[0][0]+' high-confidence');db.close()})()"
```

### 7. Output Format

```
📊 Code Metrics
━━━━━━━━━━━━━━━

Lines of Code:    4,823
Files:            47
Test Coverage:    78% (target: 80%)

Largest files:
████████████ worker/src/index.ts     (3,500 lines) ⚠️
██████░░░░░░ scripts/bot/notify.js   (720 lines)
████░░░░░░░░ scripts/hooks/prompt.js (380 lines)

Dependencies:     23 prod + 4 dev
Outdated:         3 packages
Vulnerabilities:  0 high/critical ✓

Learnings:        42 total, 8 high-confidence
```

Show bar charts using Unicode blocks (█░).
Flag files >500 lines with ⚠️.
