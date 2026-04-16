# Design System Overview

The web dashboard uses a warm, Basecamp-inspired design system built on Tailwind CSS + Radix UI.

## Tech Stack

- **Tailwind CSS 3** — Utility-first styling with custom theme
- **Radix UI** — Unstyled, accessible component primitives
- **CVA (class-variance-authority)** — Variant-based component styling
- **clsx + tailwind-merge** — Smart class composition via `cn()` utility
- **Lucide React** — Icon library
- **Recharts** — Data visualization
- **TipTap** — Rich text editing

## Theme

### Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `warm.bg` | `#F6F6F3` | Page background (off-white) |
| `warm.card` | `#FFFFFF` | Card backgrounds |
| `warm.border` | `#E0DED9` | Subtle borders |
| `warm.text` | `#1A1A1A` | Primary text |
| `warm.text-secondary` | `#787774` | Secondary/muted text |
| `brand.DEFAULT` | `#1E8B5E` | Primary action (sage green) |
| `brand.hover` | `#176B49` | Hover state |
| `brand.light` | `#E7F5EE` | Light green backgrounds |

### Spacing & Radius

| Token | Value | Usage |
|-------|-------|-------|
| `borderRadius.card` | 16px | Card corners |
| `borderRadius.btn` | 10px | Button corners |
| `borderRadius.badge` | 6px | Badge corners |

### Typography

| Token | Size | Weight | Usage |
|-------|------|--------|-------|
| `page-title` | 32px | 800 | Page headings |
| `section-title` | 18px | 700 | Section headings |

### Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `overlay` | `0 4px 16px rgba(0, 0, 0, 0.12)` | Dropdowns, dialogs |

## Design Principles

1. **Non-technical audience** — No jargon, raw IDs, or technical identifiers
2. **Warm palette** — Sage green accents on off-white, Basecamp-style
3. **Accessible** — Radix primitives with built-in ARIA
4. **Responsive** — Mobile-first with `md:` breakpoint for desktop sidebar
5. **Consistent layout** — Shell → Sidebar + PageHeader + Content pattern
