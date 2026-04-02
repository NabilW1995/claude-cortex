---
description: Accessibility (a11y) rules for web applications
globs: "src/**/*.{tsx,jsx,html,vue,svelte}"
---

# Accessibility

## Images
- MUST: All img elements need alt text
- Decorative images: alt=""
- Informative images: Descriptive alt text

## Forms
- MUST: Every input needs a label (not just a placeholder)
- MUST: Error messages are linked to the input (aria-describedby)
- MUST: Required fields are marked

## Colors and Contrast
- MUST: Color contrast at least 4.5:1 (WCAG AA)
- NEVER: Color as the only distinguishing feature
- MUST: Keep focus styles visible (never global outline:none)

## Navigation
- MUST: All interactive elements reachable via keyboard
- MUST: Meaningful heading hierarchy (h1, h2, h3 — no skipping levels)
- MUST: Skip-to-content link for screen readers
- MUST: aria-labels for icon buttons without visible text

## Dynamic Content
- MUST: aria-live for dynamically updated content
- MUST: Modals trap focus (focus trap)
- MUST: Loading states are recognizable for screen readers
