# Worktree Lifecycle

Invariants for when bake.dev creates, resurrects, removes, and preserves sessions / branches / worktrees. Landed in plan-050. Read this before changing any code that touches session state — the pre-plan-050 scatter of creation paths is gone, and new code should route through the three event types below.

## Core rule

**Branches are persistent. Worktrees are ephemeral scratch space.** A branch ref is cheap (~40 bytes, purely a name); a worktree is a full filesystem checkout (tens of MB per plan). Treat them accordingly: never destroy a branch, never keep a worktree around longer than needed.

## Branch naming

All bake-managed branches live under a shared `bake/` namespace so they are easy to filter locally and on GitHub:

- `bake/plan/<plan-id>` — for plan sessions, e.g. `bake/plan/plan-050`.
- `bake/vibe/<adjective>-<noun>` — for vibe sessions, e.g. `bake/vibe/swift-fox`.

Legacy branches without the `bake/` prefix (`plan/<id>`, `vibe/<name>`) are still accepted by reconcile for backward compatibility.

## The three event types that drive creation

Every creation or recreation of session state happens via exactly one of these. If you find yourself writing creation logic that doesn't fit one of them, you're probably re-introducing the pre-plan-050 scatter.

### 1. "Thing born"

**Trigger:** `+ New Plan`, `+ New Vibe`, or reconcile adopting an orphan plan markdown file (Case A).

**Creates:** session row + branch + worktree. All three together, in the same tick, not split across code paths.

**Code paths:** `handleCreatePlan` (DayToDaySidebar, BacklogView, Layout, PlansSidebar), `handleCreateVibe`, `createSession()` in `src/main/sessions.ts`, `reconcileSessions()` phase 3 for orphan adoption.

### 2. "Worktree needs resurrection"

**Trigger:** a session row exists in `sessions.json` with `branch` set but `worktreePath: null`. Happens whenever a merged plan's worktree has been swept by the scheduled cleanup process.

**Creates:** worktree only. Session row and branch already exist; we just re-materialize the disk checkout from the surviving branch.

**Why first-class:** every merged plan eventually lives in this state. Clicking an old plan transparently resurrects its worktree without any special ceremony.

### 3. "User is just looking"

**Trigger:** tab click, dropdown browse, sidebar hover, auto-switch effect, anything read-shaped.

**Creates:** nothing. Zero side effects. Reading is not working. If the session for a plan doesn't exist, fall through to the main session so the UI stays usable — don't mint one.

## Case A vs Case B

When reconcile discovers it needs a branch and the branch isn't there:

- **Case A — new plan id, no session row ever existed.** Safe to create `bake/plan/<id>` fresh from `main`.
- **Case B — session row claims branch X, but X is missing locally.** Red flag — the branch *used to have real commits*. **Never fabricate a replacement from HEAD.** Mark `session.error = 'branch-missing'`, skip worktree creation, and let the user decide how to recover.

The invariant: **never re-create a branch name that a session row already claimed.**

## Merge lifecycle

- On merge: session branch is merged into main; **branch is NOT deleted** (preserved forever); **worktree is NOT removed immediately** (30-min grace period); `markPlanComplete` writes a fresh ISO `completed:` timestamp. Every merge refreshes the timestamp.
- Scheduled cleanup (every 5 min + on app start): for each complete plan whose `completed:` is older than 30 minutes, check for follow-up commits ahead of main. If > 0 commits ahead: skip and surface a warning banner. Otherwise: sweep `git worktree remove --force` and clear `worktreePath`. The session row and branch survive so event type #2 can resurrect the worktree later.
- Remote cleanup (pushing / remote branch deletion) is out of scope here — it belongs to a future GitHub sync flow.
