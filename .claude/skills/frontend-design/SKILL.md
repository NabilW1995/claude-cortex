---
name: frontend-design
description: "Use when user asks to build web components, pages, or applications. Triggers on: 'build me a page', 'design a component', 'make this look better', 'landing page', 'website erstellen', 'UI bauen'"
allowed-tools: Write, Edit, Read, Bash(browser-use *), WebFetch
---

# Frontend Design Skill

Based on the official Anthropic frontend-design skill. Enhanced with our design workflow integration.

## Before Writing Any Code

Every design task starts with understanding, not coding. Follow this sequence:

### Step 1: Understand the Context

Ask these questions (one at a time, not all at once):

1. **What are we building?** — "Was genau soll gebaut werden?"
   - A complete page? A single component? A section?
   - New design or adding to existing?

2. **Who is this for?** — "Für wen ist das?"
   - Target audience affects every design decision
   - B2B = professional, trust-building
   - B2C = engaging, conversion-focused
   - Internal = functional, efficient

3. **What's the vibe?** — "Welche Stimmung soll es haben?"
   Translate user language into design direction:
   - "Modern und clean" → Minimalist with bold typography, generous whitespace
   - "Bunt und verspielt" → Playful with saturated colors, rounded shapes, micro-animations
   - "Professionell" → Editorial/magazine style, muted tones, grid-based hierarchy
   - "Wie Apple" → Ultra-minimal, product-focused, cinematic imagery
   - "Wie eine Zeitung" → Multi-column, serif fonts, typographic hierarchy
   - "Luxuriös" → Lot of breathing room, gold/dark tones, refined serifs
   - "Tech/Startup" → Bold sans-serif, dark mode, gradient accents
   - "Kreativ/Agentur" → Asymmetric layouts, unexpected interactions, brutalist touches

4. **Existing design system?** — "Gibt es schon ein Design-System oder Farben?"
   - Check for DESIGN.md, Tailwind config, CSS variables
   - If yes: follow it strictly
   - If no: create one using `ui-ux-pro-max` skill

5. **Stitch or local?** — Follow the design-flow.md rule:
   - For whole pages/websites → recommend Google Stitch
   - For quick components → design locally
   - User decides

### Step 2: Choose Design Direction

Present 2-3 distinct options. Each option includes:
- A style name (e.g., "Swiss Modernism", "Organic Biophilic", "Dark Mode OLED")
- A font pairing (Display + Body)
- A color palette (Primary + Accent + Neutral)
- A one-sentence description of the feel

Use `ui-ux-pro-max` skill to search for matching styles:
```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<industry> <keywords>" --design-system
```

Wait for the user to pick before writing any code.

### Step 3: Implement

Write production-grade code with meticulous aesthetic attention.

## Design Thinking

Commit to a BOLD aesthetic direction. The worst designs are the ones that try to be everything — pick a lane and own it.

**The key insight:** Bold maximalism and refined minimalism both work. What fails is timid, uncommitted design. The user should look at the result and immediately feel something.

## Aesthetics Guidelines

### Typography

Choose fonts that are beautiful, unique, and interesting. Typography is the single biggest differentiator between "AI-generated" and "professionally designed."

**Never use:** Arial, Inter (as display), Roboto, system-ui, sans-serif (generic)
**Instead:** Pick distinctive fonts from Google Fonts or Fontsource

Pair a display font (headlines, hero text) with a body font (paragraphs, UI text):
- Display should have personality and presence
- Body should be readable and clean
- The contrast between them creates visual interest

### Color & Theme

Build a cohesive palette using CSS variables. Colors convey emotion before the user reads a single word.

**Principles:**
- Dominant color with sharp accent outperforms evenly-distributed palettes
- Dark themes feel premium and modern
- Light themes feel clean and trustworthy
- Never use pure #000000 or pure #FFFFFF — use off-blacks and warm whites

**Never:** Purple gradient on white background (the #1 sign of AI-generated design)

Use `ui-ux-pro-max` to find industry-appropriate palettes:
```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<keywords>" --domain style
```

### Motion & Animation

Animation adds life, but restraint is key. One well-orchestrated entrance animation creates more impact than twenty scattered hover effects.

- **Page load:** Staggered reveals for hero sections (opacity + translateY)
- **Scroll:** Subtle parallax or fade-in-on-scroll for content sections
- **Interactions:** Smooth state transitions on buttons, cards, inputs
- **Implementation:** CSS animations first, framer-motion/Motion for complex React animations
- **Performance:** Use `transform` and `opacity` only (GPU-accelerated), never animate `width`/`height`/`top`

### Spatial Composition

Break out of the "centered box" pattern. The layout itself should be interesting.

- Asymmetric grids with varying column widths
- Overlap and layering (z-index, negative margins)
- Generous negative space in some areas, controlled density in others
- Full-bleed sections alternating with contained ones
- Grid-breaking elements that create visual tension

### Backgrounds & Texture

No flat, solid backgrounds. Create depth and atmosphere:

- Gradient meshes with subtle color transitions
- Noise/grain overlays (CSS: `filter: url(#noise)` or SVG)
- Geometric patterns (CSS-only or SVG)
- Layered transparencies for depth
- Dramatic shadows on elevated elements

## Anti-Patterns (AI Slop to AVOID)

These are the telltale signs of generic AI output. Avoiding them is what separates good design from "looks like ChatGPT made it":

| Pattern | Why it's bad | What to do instead |
|---------|-------------|-------------------|
| Card grid with rounded corners + shadow | Everyone does it — invisible | Asymmetric layout, varied card sizes, or list views |
| Purple/blue gradient hero | Overused to the point of parody | Solid bold color, photo, or textured background |
| "Welcome to [App Name]" | Generic, says nothing | Benefit-focused headline or provocative statement |
| Identical spacing everywhere | Monotonous rhythm | Vary padding/margins to create visual hierarchy |
| Stock photo placeholders | Screams "not real" | Use `picsum.photos`, illustrations, or solid color blocks |
| Cookie-cutter component library | No personality | Customize every component — borders, radius, shadows, colors |
| Inter font everywhere | The default AI font | Distinctive display + clean body pairing |
| Centered single-column | Safe but boring | Multi-column, asymmetric, or editorial layouts |

## Framework-Specific Guidance

### React / Next.js
- Use CSS Modules or Tailwind (match project convention)
- framer-motion / Motion for animations
- next/image for optimized images
- Server Components for static content, Client for interactions

### HTML + Tailwind
- Custom Tailwind config for unique colors/spacing
- CSS animations via `@keyframes` in globals
- Responsive: mobile-first with sm/md/lg/xl breakpoints

### Vue / Nuxt
- Scoped styles with CSS variables
- Vue transitions for page/component animations
- Nuxt Image for optimization

## Visual Review

After implementing, always verify visually using Browser Use CLI:

```bash
browser-use open http://localhost:3000
browser-use screenshot design-review.png
```

Check:
- Does it look like the chosen design direction?
- Are fonts loading correctly?
- Are animations smooth?
- Does it work on mobile? (`browser-use eval "window.innerWidth = 375"`)
- Is contrast sufficient for accessibility?

Show the screenshot to the user for approval before considering the task done.

## Working with Other Skills

| Situation | Skill to use |
|-----------|-------------|
| Need style/color/font recommendations | `ui-ux-pro-max` |
| Building with Stitch | `stitch-design` + `enhance-prompt` |
| Need premium anti-generic rules | `taste-design` |
| Using shadcn/ui components | `shadcn-ui` |
| Need design system documentation | `design-md` |
| Converting Stitch to React | `react:components` |

## For Non-Programmers

When showing design options:
- Show the name + a short description of the vibe
- Explain WHY each option fits their project
- Use simple language: "Das gibt der Seite eine Premium-Ausstrahlung" statt "asymmetric grid with hierarchical typography"
- Let them pick — never impose a design
- After implementation, show a screenshot and ask for feedback

## Rules

- Always ask the user about their design preferences before coding — even a 10-second question saves hours of rework
- Present 2-3 options with clear descriptions — let the user choose
- Use `ui-ux-pro-max` for data-driven style recommendations — don't just guess
- Verify visually with Browser Use before declaring done — screenshots don't lie
- Explain design decisions in simple language — the user needs to understand WHY
- Never use the anti-patterns listed above — they mark output as "AI-generated"
- Match existing project conventions if a design system exists
- Create a DESIGN.md if the project doesn't have one yet

## Gotchas

- NEVER use generic AI aesthetics: no purple gradients, no Inter font everywhere, no card-grid layouts
- Always check taste-design rules before generating designs
- Mobile-first responsive design is mandatory — start with smallest breakpoint
- Must run browser-use screenshot for visual verification after building
