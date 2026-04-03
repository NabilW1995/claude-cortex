---
description: "The main entry point for building anything. Use when user wants to build, create, implement, or add something. Triggers on intent like: building features, creating something new, having an idea, planning something bigger, adding functionality. Works in German and English."
argument-hint: [feature description]
---

# Build Feature

The main workflow for building features. Guides from idea to implementation.

## Step 1: What are we building?

If `$ARGUMENTS` is provided, use it as starting point. Otherwise ask:
- What feature do you want to build?
- Any specific requirements?

## Step 2: Plan Mode

Enter Plan Mode. Design the approach:
- Requirements and scope
- Files to create/modify
- Data structures and APIs
- Edge cases and error handling

Present the plan. Wait for user approval.

## Step 3: How should we implement?

After plan is approved, ask the user using AskUserQuestion:

**"How should we implement this?"**

- **Agent Teams** — 3 parallel teammates (Backend, Frontend, Tests). Best for large features that touch multiple areas. Uses separate context windows for better results.
- **Pipeline** — Sequential flow: Coder → Test-Runner → Code-Review. Best for focused features in one area. Our standard quality pipeline.
- **Direct** — Just code it. Best for small changes under 10 lines. No subagents needed.

## Step 4a: Agent Teams (if chosen)

Assign teammates based on the feature:
1. Define roles (e.g., Backend Engineer, Frontend Engineer, Test Engineer)
2. Define data contracts between teammates
3. Spawn all teammates in parallel
4. Teammates coordinate via shared Task List
5. After all finish: integrate, test, review

## Step 4b: Pipeline (if chosen)

Follow the standard Cortex pipeline:
1. Dispatch core--coder agent with the plan
2. After coder finishes: dispatch core--test-runner
3. After tests pass: dispatch core--code-review
4. After review: /sanity-check
5. Done

## Step 4c: Direct (if chosen)

Implement directly without subagents. For small, focused changes.

## Critical Rules

- MUST: Always start with Plan Mode — no coding without a plan
- MUST: Ask user which implementation strategy AFTER plan is approved
- MUST: After each milestone, ask user before continuing (human-gated)
- MUST: Run tests before saying "done"
- MUST: Break subtasks small enough to complete in under 50% context
