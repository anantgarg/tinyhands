# Component Patterns

## Base UI Components (`web/src/components/ui/`)

18 primitive components using Radix UI + CVA variants.

### Button

Variant-based via CVA:
- **Variants**: `default` (brand green), `secondary` (neutral), `danger` (red), `ghost` (transparent), `outline` (bordered), `link` (underline)
- **Sizes**: `sm` (h-8), `default` (h-10), `lg` (h-12), `icon` (h-9 w-9)

### Card

Composition pattern with sub-components:
- `Card`, `CardHeader`, `CardFooter`, `CardTitle`, `CardDescription`, `CardContent`

### Form Inputs

- `Input` — Text input
- `Textarea` — Multi-line
- `Select` — Radix dropdown
- `Label` — Form labels
- `Switch` — Toggle (Radix)

### Data Display

- `Table` — Radix headless table (`Table`, `TableHeader`, `TableBody`, `TableHead`, `TableRow`, `TableCell`)
- `Badge` — Colored status indicators
- `Avatar` — User/agent avatar (Radix)
- `Skeleton` — Loading placeholder

### Overlays

- `Dialog` — Modal dialog (Radix)
- `DropdownMenu` — Context menu (Radix)
- `Tooltip` — Hover tooltip (Radix)
- `Toast` — Notification toast (Radix) + `useToast` hook

### Utility

- `Separator` — Visual divider
- `Tabs` — Tab navigation (Radix)

## Layout Components (`web/src/components/layout/`)

### Shell

Main layout wrapper. Sidebar + content area with `<Outlet />`. Mobile: hamburger menu with dark backdrop overlay. Content capped at 1200px.

### Sidebar

Navigation with sections:
- **Main**: Dashboard, Agents, Documents
- **Manage**: Tools, Skills, KB, Connections, Triggers
- **Review**: Requests, Errors, Evolution, Audit
- **Settings**: Access, Settings

Badge counts for notifications. Collapsible via Zustand store.

### PageHeader

Standardized: title (32px bold) + optional description + action slot (children).

### TopBar

Mobile-only header with menu toggle.

## Feature Components

### StatCard

Metrics display: label, value, optional trend (+/- %), colored icon.

### RichTextEditor

TipTap-based markdown editor with bold, headings, lists, and inline `@`-mention autocomplete (when `enableUserMentions` is set). Typing `@` opens a caret-anchored Slack-user picker (avatar + name, keyboard nav, scroll-into-view); selecting a person inserts a `SlackMention` node that renders as a `@RealName` chip in the editor and serializes to `<@USERID>` in the stored prompt, so Slack runtime mentions keep working.

### EmptyState / ErrorBoundary

Standard empty and error UI patterns.

### Agent Creation Flow (`web/src/components/creation-chat/`)

Multi-step wizard via `useCreationFlow` state machine:
- Phases: INIT → DESCRIBE → ANALYZING → SUMMARY → CLARIFY → PROMPT_REVIEW → CHANNEL → ACTIVATION → SCHEDULE → TOOLS → EFFORT → MEMORY
- Card types: `YesNoCard`, `MultiChoiceCard`, `MultiSelectCard`, `DropdownCard`, `ConfirmationCard`, `ScheduleCard`, `PromptPreviewCard`

## Styling Approach

1. **CVA variants** — For components with multiple visual states
2. **Tailwind + cn()** — Direct utility class composition with conditional classes
3. **Radix + Tailwind** — Unstyled primitives wrapped with Tailwind classes
4. **Theme tokens** — `text-warm-text`, `bg-brand`, `border-warm-border` throughout

## Page Structure Pattern

```
<PageHeader title="..." description="...">
  <Button>Action</Button>
</PageHeader>

{isLoading ? <Skeleton /> : (
  <Card>
    <Table>...</Table>
  </Card>
)}
```

## Data Patterns

- **React Query** for all server data (queries + mutations)
- **Zustand** for client state (auth, sidebar)
- **Local state** for UI concerns (search, filters, modals)
- **Toast** notifications for mutation feedback
- **Lazy loading** for all page components via `React.lazy()`

## API Client

`web/src/api/client.ts` — Typed wrapper with automatic snake_case ↔ camelCase conversion. Each API module (agents, kb, docs, etc.) exports React Query hooks.
