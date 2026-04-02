Generate a changelog from git history.

## Steps

### 1. Determine range

Check if there are git tags:
```bash
git tag --sort=-v:refname | head -5
```

If tags exist: changelog from last tag to HEAD.
If no tags: changelog from last 50 commits.

### 2. Get commits

```bash
git log [range] --oneline --no-merges
```

### 3. Group by type

Parse commit messages by conventional commit prefix:
- `feat:` → Features
- `fix:` → Fixes
- `refactor:` → Refactoring
- `docs:` → Documentation
- `test:` → Tests
- `chore:` → Maintenance
- `perf:` → Performance

### 4. Format output

```markdown
## Changelog — [version or date range]

### 🚀 Features
- description (#PR)
- description (#PR)

### 🔧 Fixes
- description (#PR)

### 📝 Documentation
- description

### ♻️ Refactoring
- description

### Contributors
- User1 (X commits)
- User2 (X commits)
```

### 5. Ask the user

"Should I save this as CHANGELOG.md or just show it?"

If save: Write to CHANGELOG.md and commit.
