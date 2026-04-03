---
description: Design workflow - Stitch vs Local, step-by-step process for UI/design tasks
globs: "**/*"
---

# Design Flow (MUST follow for every UI/design task)

## Step 1: Ask the user — Which path?
MUST: For EVERY design/UI task, FIRST ask the user:

**Option A: Google Stitch** (recommended for full pages & websites)
- High-fidelity designs are generated in Stitch
- Uses the Stitch MCP connection + Skills
- Result: Professional screens that get converted to code

**Option B: Local Design** (for quick components & small changes)
- Claude designs directly in code
- Uses frontend-design + ui-ux-pro-max Skills
- Result: Code-first, faster for small tasks

## Step 2A: Google Stitch Workflow (if Option A chosen)
1. Activate `enhance-prompt` Skill — Transform user idea into a precise Stitch prompt
2. Activate `taste-design` Skill — Load premium design rules (Anti-Generic)
3. Activate `stitch-design` Skill — Generate screen(s) in Stitch via MCP
4. User reviews the design in Stitch (https://stitch.withgoogle.com/)
5. Upon approval:
   - `design-md` Skill — Document design system as DESIGN.md
   - `react-components` Skill — Convert Stitch screens to React components (if React)
   - Or manually: Write code based on DESIGN.md
6. `browser-use screenshot` — Visual review of the finished code
7. For multi-page websites: Use `stitch-loop` Skill (automates screen by screen)

## Step 2B: Local Design Workflow (if Option B chosen)
1. Activate `frontend-design` Skill — Load design philosophy
2. Activate `ui-ux-pro-max` Skill — 67 styles, 96 palettes, 57 font pairings
3. Ask user about preferences (style, colors, mood)
4. Show 2-3 options (never just force one)
5. Wait for approval
6. Write code
7. `browser-use screenshot` — Visual review

## Design Rules (apply to BOTH paths)
- MUST: No generic AI look (purple gradients, Inter font, card layouts)
- MUST: Follow `taste-design` rules — no neon, no #000000, no generic placeholders
- MUST: Visual review via Browser Use before completion
- MUST: When using shadcn/ui — activate `shadcn-ui` Skill
