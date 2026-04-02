---
description: Git workflow and branch management rules
globs: "**/*"
---

# Git Workflow Rules

## Branches
- NEVER: Commit directly to main/master
- MUST: Use feature branches: feature/description, fix/description
- MUST: Branch name describes what is being done
- NEVER: Force push — destroys shared history and is irreversible

## Commits
- Format: <type>: <description>
- Types: feat, fix, refactor, docs, test, chore, perf, ci
- Example: "feat: add contact form with email validation"
- Small, focused commits — one commit per logical change
- MUST: Run tests before committing
- MUST: Review changes with `git diff` before committing

## Feature Workflow
1. New branch: `git checkout -b feature/description`
2. Implement in small steps
3. Write and run tests
4. Push: `git push -u origin feature/description`
5. Show preview link to user
6. Wait for feedback
7. Create PR when user is satisfied
8. Merge after review

## Security
- MUST: Checkpoint commit before major refactors
- MUST: Review changes with `git diff` before committing
- NEVER: `git reset --hard` without explicit instruction
- NEVER: Commits with secrets — check before every push
