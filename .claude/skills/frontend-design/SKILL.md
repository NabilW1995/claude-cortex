---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, or applications. Generates creative, polished code that avoids generic AI aesthetics.
trigger: When the user asks to build UI components, pages, websites, or applications
---

# Frontend Design Skill

Based on the official Anthropic frontend-design skill (277K+ installs).

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:

- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian
- **Constraints**: Technical requirements (framework, performance, accessibility)
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

CRITICAL: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work — the key is intentionality, not intensity.

Then implement working code that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Aesthetics Guidelines

### Typography
- Choose fonts that are beautiful, unique, and interesting
- NEVER use generic fonts: Arial, Inter, Roboto, system fonts
- Pair a distinctive display font with a refined body font
- Use Google Fonts or Fontsource for easy integration

### Color & Theme
- Commit to a cohesive aesthetic using CSS variables
- Dominant colors with sharp accents outperform timid, evenly-distributed palettes
- NEVER use cliched color schemes (particularly purple gradients on white backgrounds)
- Vary between light and dark themes across projects

### Motion & Animation
- Use animations for micro-interactions and page transitions
- Prioritize CSS-only solutions for HTML
- Use Motion library (framer-motion) for React when available
- Focus on high-impact moments: one well-orchestrated page load with staggered reveals creates more delight than scattered micro-interactions

### Spatial Composition
- Unexpected layouts, asymmetry, overlap, diagonal flow
- Grid-breaking elements
- Generous negative space OR controlled density
- NEVER default to predictable centered-content-in-container

### Backgrounds & Visual Details
- Create atmosphere and depth — no solid color backgrounds
- Gradient meshes, noise textures, geometric patterns
- Layered transparencies, dramatic shadows, decorative borders
- Grain overlays, custom cursors

## Anti-Patterns (AI Slop to AVOID)
- Generic card-based layouts with rounded corners and shadows
- Purple/blue gradient hero sections
- "Welcome to [App Name]" hero text
- Identical spacing and sizing throughout
- Stock-photo-style placeholder content
- Cookie-cutter component libraries without customization

## For Non-Programmers
When the user describes a design vision in their own words:
- "Modern und clean" → Minimalist with bold typography, lots of whitespace
- "Bunt und verspielt" → Playful with saturated colors, rounded shapes, animations
- "Professionell" → Editorial/magazine style, muted tones, grid-based
- "Wie Apple" → Ultra-minimal, product-focused, cinematic imagery
- "Wie eine Zeitung" → Multi-column, serif fonts, hierarchical typography

MUST: Always ask which vibe the user wants before designing
MUST: Show 2-3 font/color options and let the user pick
MUST: Explain design decisions in simple language

