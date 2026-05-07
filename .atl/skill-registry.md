# Skill Registry — AI-Native N4

Generated: 2026-05-07

## User Skills (global)

| Skill | Trigger | Source |
|-------|---------|--------|
| go-testing | Go tests, Bubbletea TUI testing | ~/.claude/skills/go-testing/ |
| skill-creator | Creating new AI skills | ~/.claude/skills/skill-creator/ |
| impeccable | Frontend design, redesign, UX/UI work | ~/.claude/skills/impeccable/ |

## Project Skills

| Skill | Trigger | Source |
|-------|---------|--------|
| help-system-content | Adding pages/forms with HelpButton | .claude/skills/help-system-content/ |
| openspec-apply-change | /opsx:apply | .claude/skills/openspec-apply-change/ |
| openspec-archive-change | /opsx:archive | .claude/skills/openspec-archive-change/ |
| openspec-explore | /opsx:explore | .claude/skills/openspec-explore/ |
| openspec-propose | /opsx:propose | .claude/skills/openspec-propose/ |

## SDD Skills (global)

| Skill | Phase | Source |
|-------|-------|--------|
| sdd-init | init | ~/.claude/skills/sdd-init/ |
| sdd-explore | explore | ~/.claude/skills/sdd-explore/ |
| sdd-propose | propose | ~/.claude/skills/sdd-propose/ |
| sdd-spec | spec | ~/.claude/skills/sdd-spec/ |
| sdd-design | design | ~/.claude/skills/sdd-design/ |
| sdd-tasks | tasks | ~/.claude/skills/sdd-tasks/ |
| sdd-apply | apply | ~/.claude/skills/sdd-apply/ |
| sdd-verify | verify | ~/.claude/skills/sdd-verify/ |
| sdd-archive | archive | ~/.claude/skills/sdd-archive/ |

## Compact Rules

### impeccable (auto-load for UI work)
- Gates: PRODUCT.md + DESIGN.md must exist before touching UI code
- Run `impeccable teach` if missing
- Stitch design system tokens in DESIGN.md

### help-system-content (auto-load for new pages)
- HelpButton mandatory on every page
- Content never inline — goes in helpContent.tsx
- size="sm" in form modals
- Modal variants: light/dark

## Project Conventions
- CLAUDE.md: primary source of truth for agent behavior
- 40 ADRs in docs/adr/ — required for architectural changes
- Conventional Commits with service scope
- Python: ruff + mypy --strict | TS: biome + tsc
