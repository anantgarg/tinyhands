# TinyHands Design System

Inspired by Basecamp's design language: clean, flat, utilitarian, and human-friendly.

## Core Principles

1. **Clean & Flat** -- No gratuitous shadows or gradients. Borders define structure, not depth effects. UI gets out of the way so content speaks.
2. **Bold & Readable** -- Large, extrabold page titles. System font stack for maximum legibility. Generous line height and spacing.
3. **Card-Based Layout** -- Content organized into flat bordered cards. Consistent padding. Single-column stacked layouts preferred over complex grids.
4. **Human-Friendly** -- Conversational labels, helpful empty states, clear action verbs. States (loading, empty, error) always handled gracefully.
5. **Green for Action** -- Primary actions use a confident green. Most of the UI is grayscale; color is reserved for meaning.

## Color Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `warm-bg` | `#F6F6F3` | Page background (light warm gray) |
| `warm-card` | `#FFFFFF` | Card and surface backgrounds |
| `warm-sidebar` | `#FFFFFF` | Sidebar background (clean white) |
| `warm-border` | `#E0DED9` | Borders, dividers, separators |
| `warm-text` | `#1A1A1A` | Primary text (near black) |
| `warm-text-secondary` | `#787774` | Secondary text, labels, captions |
| `brand` | `#1E8B5E` | Primary buttons, links, active indicators (Basecamp green) |
| `brand-hover` | `#176B49` | Button hover state |
| `brand-light` | `#E7F5EE` | Active nav item bg, default badge bg |
| Success | `#1E8B5E` | Success badges (same as brand) |
| Warning | `#D97706` | Warning badges, pending states |
| Danger | `#DC2626` | Error badges, destructive actions |

### Color Usage Guidelines

- **Minimal color**: Most UI is grayscale. Color indicates meaning (active state, status, action).
- **Green = action**: Primary buttons, active nav, success states all share the brand green.
- **No colored backgrounds on stat cards**: Use light tinted icon backgrounds only.
- Charts use brand green with subtle opacity gradients.
- Danger/destructive actions use red-600, not the brand color.

## Typography

| Element | Size | Weight | Line Height |
|---------|------|--------|-------------|
| Body | 15px (base) | 400 | 1.5 |
| Page title | 32px (`text-page-title`) | 800 (extrabold) | 1.2 |
| Section title | 18px (`text-section-title`) | 700 (bold) | 1.3 |
| Card title | 18px | 700 (bold) | 1.3 |
| Small text | 14px (`text-sm`) | 400 | 1.5 |
| Caption | 12px (`text-xs`) | 500 (medium) | 1.4 |
| Nav section label | 11px | 700 (bold) | uppercase tracking-wider |

- **Font stack**: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif` (system fonts, like Basecamp)
- Page titles are noticeably large and extrabold -- the most prominent element on the page.
- Section labels in sidebar: `text-[11px] font-bold uppercase tracking-wider text-warm-text-secondary/50`

## Spacing

| Context | Value |
|---------|-------|
| Page padding | 32px (`p-8`) |
| Card padding | 20-24px (`px-6 py-5`) |
| Card gap | 16px (`gap-4`) |
| Section gap | 24px (`mb-6`) |
| Header bottom margin | 32px (`mb-8`) |
| Input/button height | 40px (`h-10`) |
| Nav item padding | `px-3 py-[7px]` |

## Border Radius

| Element | Radius | Tailwind Class |
|---------|--------|----------------|
| Cards | 16px | `rounded-card` |
| Buttons, Inputs | 10px | `rounded-btn` |
| Badges | 6px | `rounded-badge` |
| Nav items | 8px | `rounded-lg` |
| Full round | 9999px | `rounded-full` (avatars, switches) |

## Shadows

Minimal. Basecamp-inspired flat design.

- **Cards**: No shadow by default. Border only (`border border-warm-border`).
- **Card hover** (optional): `shadow-card-hover` (subtle, 0 2px 8px rgba(0,0,0,0.08))
- **Dropdowns/Dialogs**: `shadow-lg` (only for overlays)
- **Buttons**: No shadow. Use `active:scale-[0.98]` for press feedback instead.

## Component Customizations

### Button
- **Default**: `bg-brand text-white`, hover `bg-brand-hover`, press `active:scale-[0.98]`
- **Secondary**: `bg-warm-bg border border-warm-border`, hover `bg-white`
- **Danger**: `bg-red-600 text-white`, hover `bg-red-700`
- **Ghost**: transparent, hover `bg-warm-bg`, text `warm-text-secondary` -> `warm-text`
- **Outline**: `border border-warm-border bg-white`, hover `bg-warm-bg`
- **Link**: `text-brand`, underline on hover, no padding
- Focus: `ring-2 ring-brand ring-offset-2`
- Font: `font-semibold` (not just medium)

### Card
- Background: `bg-warm-card` (white)
- Border: `border border-warm-border`
- **No shadow** (flat, like Basecamp)
- Radius: `rounded-card` (16px)
- Header: `px-6 pt-5 pb-0`
- Content: `px-6 py-5`

### Input / Textarea
- Border: `border-warm-border`
- Focus: `ring-2 ring-brand/20 border-brand` (subtle green tint, not heavy ring)
- Height: `h-10`
- Placeholder: `text-warm-text-secondary/60`
- Radius: `rounded-btn` (10px)

### Badge
- Variants use soft pastel backgrounds:
  - Default: `bg-brand-light text-brand`
  - Success: `bg-emerald-50 text-emerald-700`
  - Warning: `bg-amber-50 text-amber-700`
  - Danger: `bg-red-50 text-red-700`
  - Secondary: `bg-warm-bg text-warm-text-secondary`
- Size: `px-2.5 py-0.5 text-xs font-medium`
- Radius: `rounded-full`

### Table
- Header: Normal case (not uppercase), `text-sm font-medium text-warm-text-secondary`
- Row border: `border-warm-border`
- Row hover: `bg-warm-bg/60` (subtle)
- Cell padding: `px-4 py-3`

### Tabs
- Style: Underline (no background)
- Active: `border-b-2 border-brand text-warm-text font-semibold`
- Inactive: `text-warm-text-secondary`

### Dialog
- Overlay: `bg-black/40`
- Radius: `rounded-xl`
- Border: `border-warm-border`
- Max width: `max-w-lg` default

### Select
- Trigger styled like Input (same focus style)
- Dropdown: `rounded-lg shadow-lg border-warm-border`
- Items: `rounded-badge`, focus `bg-warm-bg`

### Switch
- Checked: `bg-brand` (green)
- Unchecked: `bg-warm-border`

### Toast
- Appears bottom-right
- Clean border styling, not heavy shadows

## Layout Patterns

### Page Layout
- Max content width: `max-w-[1200px]`
- Centered: `mx-auto`
- Page padding: `p-8`

### Sidebar (Basecamp-style)
- Width: 240px (expanded), 52px (collapsed)
- Background: white (`#FFFFFF`)
- Border right: `border-warm-border`
- Header: Logo + "TinyHands" in extrabold
- Active nav item: `bg-brand-light text-brand font-semibold` (green tint)
- Inactive nav: `text-warm-text-secondary`, hover `bg-warm-bg`
- User footer: Avatar + name + role + logout icon
- Section labels: tiny, bold, uppercase, very muted

### Page Header
- Title: `text-page-title` (32px extrabold)
- Description: `text-warm-text-secondary mt-1`
- Actions aligned right, slightly below title top

### Grid Layouts
- Stats: `grid grid-cols-4 gap-4`
- Side-by-side: `grid grid-cols-2 gap-4`
- Stacked cards: `space-y-3`

## State Patterns

### Loading State
`<Skeleton />` components with `animate-pulse rounded-btn bg-warm-border/50`.

### Empty State
`<EmptyState />`:
- Large icon in `rounded-2xl bg-warm-bg p-5`
- Title: `text-lg font-bold`
- Description: `text-sm text-warm-text-secondary leading-relaxed`
- Optional green CTA button

### Error State
- Toast with error variant
- Inline error message in `text-red-600`

## Icons

All from `lucide-react`. Default: `h-[18px] w-[18px]` (nav), `h-4 w-4` (inline), `h-5 w-5` (stat cards), `h-8 w-8` (empty states).

## Animation

- Minimal. Basecamp avoids flashy animations.
- Skeleton: `animate-pulse`
- Dialog/Dropdown: `animate-in fade-in-0 zoom-in-95`
- Buttons: `active:scale-[0.98]` for tactile feedback
- Transitions: `transition-colors` for hover states
