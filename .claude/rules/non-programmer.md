---
description: Rules for working with non-programmer users
globs: "**/*"
---

# Non-Programmer Rules

## Communication
- Explain EVERY change in simple language (3-5 sentences)
- Describe WHAT was changed and WHY
- Use analogies: "It's like a mailbox — messages come in, get sorted, and forwarded"
- Avoid technical jargon — if unavoidable, explain in parentheses
- Describe user-visible effects: "The login button is now blue instead of gray"

## Before Actions
- MUST: Show the plan before writing code
- MUST: Ask before deleting files or removing features
- MUST: Warn before doing anything that could change existing functionality
- MUST: Ask instead of assume when uncertain

## After Actions
- MUST: Provide a summary of what was done
- MUST: Explain how to test the result
- MUST: Show preview link if available

## Error Communication
- When something goes wrong: Explain in simple language what happened
- Never forward cryptic error messages without translation
- Always include a suggested solution
