# RPI Workflow — Research, Plan, Implement

> Ein systematischer 3-Phasen-Workflow mit Validierungs-Gates.
> Nichts wird gebaut ohne vorher gruendlich recherchiert und geplant zu haben.
> Inspiriert von: Boris Cherny / HumanLayer (Dex Horthy)

## Schnellstart

```
/rpi-research "User Authentication mit OAuth2"     ← Phase 1
/rpi-plan                                           ← Phase 2 (nach GO)
/rpi-implement                                      ← Phase 3 (nach Plan-Approval)
```

## Der Flow

```
┌─────────────────────────────────────────────────────┐
│ PHASE 1: RESEARCH — /rpi-research                   │
│                                                     │
│ Agents: requirement-parser + pre--architect          │
│                                                     │
│ Output: rpi/{feature}/REQUEST.md                     │
│         rpi/{feature}/research/RESEARCH.md           │
│                                                     │
│ Verdict: GO / NO-GO / CONDITIONAL GO / DEFER         │
└────────────────────────┬────────────────────────────┘
                         │ (nur bei GO)
┌────────────────────────▼────────────────────────────┐
│ PHASE 2: PLAN — /rpi-plan                           │
│                                                     │
│ 3 Agents parallel:                                   │
│   product-manager  → plan/pm.md  (User Stories)      │
│   ux-designer      → plan/ux.md  (UI Flows)          │
│   pre--architect   → plan/eng.md (Tech Architektur)  │
│                                                     │
│ Compiled: plan/PLAN.md (Phasen + Test-Gates)         │
│                                                     │
│ → User reviewed und approved den Plan                │
└────────────────────────┬────────────────────────────┘
                         │ (nur nach Approval)
┌────────────────────────▼────────────────────────────┐
│ PHASE 3: IMPLEMENT — /rpi-implement                 │
│                                                     │
│ Pro Phase:                                           │
│   core--coder      → Code schreiben                  │
│   core--test-runner → Tests                          │
│   core--code-review → Review                         │
│   /sanity-check    → Validierung                     │
│   USER GATE        → PASS / FAIL                     │
│                                                     │
│ Output: implement/IMPLEMENT.md (Fortschritt)         │
└─────────────────────────────────────────────────────┘
```

## Ordnerstruktur

Wird automatisch von den Commands erstellt:

```
rpi/
  user-auth/                        ← Feature-Ordner
    REQUEST.md                      ← Strukturierte Requirements
    research/
      RESEARCH.md                   ← Machbarkeitsanalyse + GO/NO-GO
    plan/
      pm.md                         ← User Stories + Akzeptanzkriterien
      ux.md                         ← UI Flows + Wireframes + Accessibility
      eng.md                        ← Technische Architektur + Schema
      PLAN.md                       ← Phasen + Tasks + Test-Gates
    implement/
      IMPLEMENT.md                  ← Fortschritt pro Phase
```

## Unsere Agents im RPI Flow

| RPI Rolle | Unser Agent | Skills |
|-----------|-------------|--------|
| Requirement Parser | rpi--requirement-parser | — |
| Product Manager | rpi--product-manager | — |
| UX Designer | rpi--ux-designer | ui-ux-pro-max, frontend-design |
| Tech Architect | pre--architect | — (isolation: worktree) |
| Software Engineer | core--coder | code-quality-rules |
| Code Reviewer | core--code-review | — |
| Test Engineer | core--test-runner | — |
| Validator | /sanity-check Skill | — |
| Doku Writer | util--pr-writer | — |

## Wann RPI nutzen?

| Situation | RPI? | Stattdessen |
|-----------|------|-------------|
| Grosses neues Feature | Ja | — |
| Architektur-Aenderung | Ja | — |
| Kritisches Feature (Auth, Payment) | Ja + Cross-Model | WORKFLOW-CROSS-MODEL.md |
| Einfaches Feature (< 1h) | Nein | /build-feature → Pipeline |
| Bug Fix | Nein | fix--root-cause-finder |
| Kleine UI-Aenderung | Nein | /build-feature → Direkt |

## Verdicts erklaert

| Verdict | Bedeutung | Naechster Schritt |
|---------|-----------|-------------------|
| **GO** | Machbar und sinnvoll | /rpi-plan |
| **NO-GO** | Nicht machbar oder nicht sinnvoll | Feature ablehnen |
| **CONDITIONAL GO** | Machbar unter Bedingungen | Bedingungen klaeren |
| **DEFER** | Jetzt nicht, spaeter vielleicht | Backlog |

## Tipps

- **Research nicht ueberspringen** — auch wenn es "offensichtlich" machbar ist, findet Research oft versteckte Risiken
- **Plan parallel erstellen** — pm.md, ux.md, eng.md entstehen gleichzeitig (3 Agents parallel)
- **User-Gate ist Pflicht** — nach jeder Implementierungs-Phase MUSS der User PASS/FAIL sagen
- **Bei FAIL nicht weitermachen** — erst fixen, dann re-testen, dann erneut fragen
- **rpi/ Ordner committen** — die Dokumente sind wertvolle Referenz fuer spaeter
