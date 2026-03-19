# TinyHands Design System

## Core Principles

1. **Warm & Approachable** -- Cream backgrounds, soft borders, and natural tones create a friendly interface that feels inviting rather than clinical.
2. **Card-Based Layout** -- Content is organized into clearly delineated cards with consistent padding, borders, and shadows.
3. **Human-Friendly** -- Typography prioritizes readability. Actions are clearly labeled. States (loading, empty, error) are always handled gracefully.
4. **Consistent Spacing** -- A rhythmic spacing system keeps the interface visually balanced and scannable.

## Color Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `warm-bg` | `#FFFDF7` | Page background |
| `warm-card` | `#FFFFFF` | Card backgrounds |
| `warm-sidebar` | `#F5F0E8` | Sidebar background, secondary surfaces |
| `warm-border` | `#E8E2D9` | Borders, dividers |
| `warm-text` | `#1D1D1D` | Primary text |
| `warm-text-secondary` | `#6B6B6B` | Secondary text, labels |
| `brand` | `#1D6CE0` | Primary buttons, links, active indicators |
| `brand-hover` | `#1557B8` | Button hover state |
| Success | `#1DB954` | Success badges, positive states |
| Warning | `#E8A317` | Warning badges, pending states |
| Danger | `#D64045` | Error badges, destructive actions |

### Color Usage Guidelines

- Use `brand` for primary actions and interactive elements only
- Use `warm-sidebar` for secondary button backgrounds and hover states
- Use semantic colors (success/warning/danger) for badges and status indicators
- Error and danger text uses `red-500` / `red-600`
- Charts use the brand color with opacity gradients

## Typography

| Element | Size | Weight | Line Height |
|---------|------|--------|-------------|
| Body | 15px (base) | 400 | 1.6 |
| H1 (Page title) | text-2xl (24px) | 700 (bold) | 1.2 |
| H2 (Section title) | text-lg (18px) | 600 (semibold) | 1.3 |
| H3 (Card title) | text-base (16px) | 600 (semibold) | 1.4 |
| Small text | text-sm (14px) | 400 | 1.5 |
| Caption | text-xs (12px) | 500 (medium) | 1.4 |
| Code/Mono | text-sm (14px) | 400 | 1.5 |

- **Font stack**: `'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- Section labels use `text-[11px] font-semibold uppercase tracking-wider text-warm-text-secondary/70`

## Spacing

| Context | Value |
|---------|-------|
| Page padding | 32px (`p-8`) |
| Card padding | 24px (`p-6`) |
| Card gap | 16px (`gap-4`) |
| Section gap | 32px (`mb-8`) |
| Header bottom margin | 32px (`mb-8`) |
| Input/button height | 40px (`h-10`) |
| Small button height | 32px (`h-8`) |

## Border Radius

| Element | Radius | Tailwind Class |
|---------|--------|----------------|
| Cards | 12px | `rounded-card` |
| Buttons, Inputs | 8px | `rounded-btn` |
| Badges | 6px | `rounded-badge` |
| Full round | 9999px | `rounded-full` (avatars, switches) |

## Shadows

- Cards: `shadow-sm` (default), `shadow-md` (hover/elevated)
- Dropdowns/Dialogs: `shadow-lg`
- Buttons: `shadow-sm` (default), `shadow` (hover)

## Component Customizations

### Button
- **Default**: `bg-brand text-white`, hover `bg-brand-hover`, shadow on hover
- **Secondary**: `bg-warm-sidebar text-warm-text`, hover `bg-warm-border`
- **Danger**: `bg-red-500 text-white`, hover `bg-red-600`
- **Ghost**: transparent, hover `bg-warm-sidebar`
- **Outline**: `border border-warm-border bg-white`, hover `bg-warm-sidebar`
- Focus ring: `ring-brand ring-offset-2`

### Card
- Background: `bg-warm-card`
- Border: `border border-warm-border`
- Shadow: `shadow-sm`
- Radius: `rounded-card` (12px)
- Header padding: `p-6`, Content padding: `p-6 pt-0`

### Input / Textarea
- Border: `border-warm-border`
- Focus: `ring-brand ring-offset-2`
- Height: `h-10` (input), variable (textarea, min `min-h-[80px]`)
- Placeholder: `text-warm-text-secondary/50`
- Radius: `rounded-btn`

### Badge
- Variants map to semantic color backgrounds with matching text
- Size: `px-2.5 py-0.5 text-xs font-medium`
- Radius: `rounded-full`

### Table
- Header: `text-xs uppercase tracking-wider text-warm-text-secondary`
- Row border: `border-warm-border`
- Row hover: `bg-amber-50/30`
- Cell padding: `px-4 py-3`

### Tabs
- Style: Underline (no background)
- Active: `border-b-2 border-brand text-warm-text`
- Inactive: `text-warm-text-secondary`
- Content margin: `mt-4`

### Dialog
- Overlay: `bg-black/40`
- Radius: `rounded-xl`
- Border: `border-warm-border`
- Max width: `max-w-lg` (default), `max-w-2xl` for larger content

### Select
- Trigger styled like Input
- Dropdown: `rounded-lg shadow-lg border-warm-border`
- Items: `rounded-badge`, focus `bg-warm-sidebar`

### Switch
- Checked: `bg-brand`
- Unchecked: `bg-warm-border`
- Thumb: white, rounded-full

### Toast
- Default: `bg-warm-card`
- Success: `bg-green-50 border-green-200`
- Error: `bg-red-50 border-red-200`
- Appears bottom-right on desktop

## Layout Patterns

### Page Layout
- Max content width: `max-w-[1200px]`
- Centered: `mx-auto`
- Page padding: `p-8`

### Sidebar
- Width: 260px (expanded), 64px (collapsed)
- Background: `#F5F0E8`
- Border right: `border-warm-border`
- Active nav item: `bg-white/70 border-l-2 border-brand shadow-sm`
- Nav item padding: `px-3 py-2`

### Page Header
- Flex container, items start, justify between
- Title: `text-2xl font-bold`
- Description: `text-warm-text-secondary mt-1`
- Actions aligned right

### Grid Layouts
- Stats: `grid grid-cols-4 gap-4`
- Cards (3-col): `grid grid-cols-3 gap-4`
- Cards (2-col): `grid grid-cols-2 gap-4`
- Forms (2-col): `grid grid-cols-2 gap-4`

## State Patterns

### Loading State
Use `<Skeleton />` components that match the approximate dimensions of the content they replace.
- Single values: `<Skeleton className="h-8 w-48" />`
- Cards: `<Skeleton className="h-[120px]" />`
- Tables: `<Skeleton className="h-[300px]" />`
- Use `Array.from({ length: n })` to render multiple skeletons

### Empty State
Use the `<EmptyState />` component:
- Large icon in a rounded circle with `bg-warm-sidebar`
- Title: `text-lg font-semibold`
- Description: `text-sm text-warm-text-secondary`, max width 400px
- Optional CTA button

### Error State
- Display error message in a card or toast
- Use `variant="error"` toast for API errors
- Mutations show error toast on failure
- Queries use react-query's built-in error handling

### Confirmation
- Destructive actions use `confirm()` dialogs
- Non-destructive mutations use optimistic updates with toast feedback

## Icons

All icons from `lucide-react`. Standard size is `h-4 w-4` (16px). Use `h-5 w-5` for stat card icons and `h-8 w-8` for empty state illustrations.

## Animation

- Skeleton: `animate-pulse`
- Dialog/Dropdown: `animate-in fade-in-0 zoom-in-95`
- Toast: `slide-in-from-bottom-full`
- Transitions: `transition-colors`, `transition-shadow` for hover states
