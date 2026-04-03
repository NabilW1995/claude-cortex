# Sanity Check Checklist

## 1. File Consistency
- [ ] CLAUDE.md exists and is under 200 lines
- [ ] .claude-template.json exists with correct version
- [ ] .env.example exists and matches .env variables
- [ ] .gitignore includes Cortex entries (CLAUDE.local.md, logs/, backups/, *.db)
- [ ] package.json has sql.js dependency and cortex scripts

## 2. Agent Health
- [ ] All agent .md files have valid YAML frontmatter
- [ ] Core agents have: model, memory, effort, color, maxTurns, permissionMode
- [ ] Agent descriptions are trigger-focused (English)
- [ ] code-quality-rules skill exists and is preloaded in core--coder

## 3. Skill Health
- [ ] All skill SKILL.md files have valid frontmatter
- [ ] All skills have description (trigger-focused)
- [ ] All skills have Gotchas section
- [ ] scaffolding and sanity-check have context: fork

## 4. Hook Health
- [ ] settings.json is valid JSON
- [ ] All hook scripts referenced in settings.json exist on disk
- [ ] Critical hooks present: guard-bash.sh, security-scan.sh, post-edit-lint.sh, session-start.js
- [ ] No hook has timeout > 5000ms (except Setup: 30000ms)

## 5. Security
- [ ] No hardcoded secrets in code files (API keys, tokens, passwords)
- [ ] .env is gitignored
- [ ] No console.log with sensitive data patterns
- [ ] SQL queries use parameterized statements

## 6. Code Quality
- [ ] No TODO(human) left unresolved
- [ ] No orphaned test files without implementation
- [ ] No duplicate logic across files
- [ ] Error handling present in async operations

## 7. Git
- [ ] Not on main/master branch (if actively developing)
- [ ] No uncommitted secrets in staged files
- [ ] Recent commits follow type: description format
