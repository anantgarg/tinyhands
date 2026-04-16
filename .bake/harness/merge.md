# Merge

Steps to run when merging a session's work back to the main branch. This is the authoritative source of truth for the merge flow — bake.dev drives merges by prompting Claude Code with this file's contents, then letting Claude run the actual git commands in the terminal. There is no IPC-based merge path.

See `.bake/harness/worktree-lifecycle.md` for the full branch/worktree lifecycle invariants that this flow is expected to respect.

## Instructions for Claude Code

Follow the steps below in order. If this file is a stub and no merge steps are configured, ask the user how they want to merge before proceeding. The calling prompt will tell you which branch to merge.

## Branch naming

Bake-managed session branches live under the `bake/` namespace:

- `bake/plan/<plan-id>` — e.g. `bake/plan/plan-050`
- `bake/vibe/<adjective>-<noun>` — e.g. `bake/vibe/swift-fox`

Legacy branches (`plan/<id>`, `vibe/<name>`) from before this convention is in place are still supported for backward compatibility — if you see one of those on an existing session, treat it the same as its `bake/`-prefixed equivalent.

## Pre-merge Checklist

- [ ] `npm run build` (or the project's build command) succeeds without errors
- [ ] No unresolved TODOs in changed files (search for `TODO`, `FIXME`, `HACK`)
- [ ] All new or modified functionality has been tested manually

## Pre-merge Plan-File Updates

These happen **in the session worktree**, before `git merge`. They edit the plan file on disk, and the edits are picked up by the "commit all uncommitted changes in the session worktree" step below — which means they travel to main as part of the merge commit.

**Do NOT run these after the merge.** If you mutate the plan file on main after merging, the preserved plan branch stays frozen at its pre-merge state while main advances, and the editor (which reads plans from the worktree) shows stale `draft` / `building` content forever. See plan-061 for the reference case.

1. **Reconcile acceptance criteria against actual work.** Open the plan file and walk every `- [ ]` / `- [x]` criterion. Check each against the git diff and test results from this branch:
   - If a criterion is ticked `- [x]` but the diff/tests don't support it, un-tick it and add a one-line note explaining why.
   - If a criterion is unticked `- [ ]` but the diff/tests show it IS done, tick it `- [x]`.
   - For any criterion **still unticked** after this pass, keep a running "deferred" list in memory. These will be appended to the backlog in the Post-merge Updates section below. **Do NOT edit the backlog now** — the backlog lives on main and its updates happen post-merge so they don't interfere with the preserved plan branch.

   The merge pass is the audit — it reflects merged reality, not intent. If the build pass and merge pass disagree, the merge pass wins.

2. **Plan status.** Set `status: complete` in the plan file's frontmatter.

3. **Completed timestamp.** Write a fresh `completed: <ISO 8601 UTC timestamp>` in the frontmatter. **Generate the value by running `date -u +"%Y-%m-%dT%H:%M:%S.000Z"`** (or the equivalent `new Date().toISOString()` in a Node REPL) and paste the output verbatim. Do not type the timestamp by hand.

   **This must be a real UTC timestamp.** The `Z` suffix means "UTC". Taking your local wall-clock reading and appending `Z` is **wrong** — it produces a timestamp that's silently offset from real UTC by your timezone. The grace timer will then count down from the wrong moment (potentially hours in the future), displaying nonsense values like "366m remaining" until the UI's upper cap kicks in. Always run `date -u` so you never have to think about timezones.

   **Always overwrite `completed:` with the current time on every merge**, even if the plan is already in `complete` status from a previous merge. This is **not optional** and **not a no-op**:

   - Bake.dev's grace timer and scheduled worktree cleanup both read this field as their clock. They use it to decide how long to keep the worktree alive after merge (the "30-minute grace period").
   - Re-merging an already-complete plan is the user's signal that they have more work to land, and they expect the grace period to extend by another 30 minutes from that re-merge moment.
   - If you skip the timestamp update because "the plan is already complete," the grace period doesn't reset, and the cleanup process may sweep the worktree out from under the user even though they just merged.

   Always a **full ISO 8601 timestamp**, not just a date — sub-minute precision is required.

## Merge Steps

1. Commit all uncommitted changes in the session worktree — this picks up the plan-file edits from the previous section so they travel with the merge commit.
2. From the main project directory, merge the session branch: `git merge <branch> --no-ff`
3. Resolve any merge conflicts if they arise.

## Post-merge Updates

After merging, update the project-level aggregation docs that live on main. These accumulate across every merge, so they belong on main and must happen after the merge lands there. (Plan status, `completed:` timestamp, and acceptance-criteria ticks are NOT listed here — those are pre-merge plan-file updates, see the section above.)

1. **Run tests** — Execute the test suite (`npm test` or as specified in `.bake/harness/testing/strategy.md` if present). All tests must pass before the merge is considered complete. If tests fail, fix them before proceeding.
2. **Changelog** — Append a one-line entry to `.bake/product/changelog.md` with today's date and a brief summary of what changed. Format: `- YYYY-MM-DD: {one-line summary}`.
3. **Backlog** — Append unfinished TODOs AND any criteria you flagged as "deferred" during the Pre-merge reconciliation pass to `.bake/tasks/backlog.md` under the `## Ideas` section. Format: `- [ ] {criterion text} (from {plan-id})`. Then append a matching traceability note to `.bake/product/changelog.md` listing every criterion that was moved to backlog: `- YYYY-MM-DD: {plan-id} merged. Deferred to backlog: {criterion text}; {criterion text}; ...`.
4. **Feature specs** — If new features were added or existing features were significantly changed, update the per-feature files under `.bake/product/features/`.
5. **Features index** — Update `.bake/product/features.md` with a one-line summary for any new or changed features. This is the master index of all features.
6. **Data model** — If new interfaces, types, or data structures were added, update `.bake/harness/data-model.md`.
7. **Dependencies** — If new packages were installed, update `.bake/harness/dependencies.md` with the package name, version, and purpose.
8. **Tech stack** — If new tools or frameworks were introduced, update `.bake/harness/tech-stack.md`.

## Post-merge: Check for documentation drift

The code you just merged is the source of truth. If any documentation under `.bake/` or `.claude/` describes behavior that this plan changed, update the docs to match.

Specifically:
- Read the plan's diff (what files changed and how).
- For each code change, ask: "Is there a doc under `.bake/product/`, `.bake/harness/`, or `.claude/rules/` that describes this behavior?"
- If yes, read that doc and check if it still agrees with the code. If not, fix the doc.
- Common drift points: data model fields vs `data-model.md`, dependency additions vs `dependencies.md`, workflow changes vs the matching harness doc, feature behavior vs the matching `features/` file.

If you find drift, fix it and tell the user what you updated and why. If nothing drifted, say so and move on — don't pad the list.

## Cleanup — DO NOT DO THESE THINGS

Branches and worktrees are managed by bake.dev's lifecycle rules. When you finish a merge, **stop**. Do not delete the branch. Do not remove the worktree. The scheduled cleanup process in bake.dev will handle both at the right time.

- **DO NOT run `git branch -d <branch>` (or `-D`).** Branches are preserved forever as historical record. Every merged branch remains a recoverable name so the worktree can be resurrected (event type #2) weeks later if the user wants to inspect, compare, or cherry-pick from the preserved history. Remote branch cleanup (GitHub's auto-delete-head-branches) is the GitHub sync plan's concern, not this flow.

- **DO NOT run `git worktree remove <path>`.** Worktree removal is deferred by 30 minutes via a scheduled cleanup process (`src/main/worktreeCleanup.ts`). The grace period lets the user:
  - Run follow-up commands in the terminal for a few minutes after the merge.
  - Commit more work into the worktree and re-merge without losing state.
  - Every re-merge rewrites the `completed:` timestamp, which resets the 30-minute window from that moment.

- **If the user has made follow-up commits after the merge** (the branch is ahead of main), the scheduled cleanup will detect them via `git rev-list <main>..<branch> --count > 0`, skip the worktree, and surface a warning banner in the UI. The worktree will remain on disk until either the user re-merges those commits or discards the branch manually.

- **If you, as Claude Code, want to verify the merge landed**, inspect the commit history with `git log --oneline <main>..HEAD` or check the worktree branch state with `git status`. Do not act on ambiguity by deleting things.

If you think you have a reason to delete a branch or remove a worktree manually — don't. Ask the user first.
