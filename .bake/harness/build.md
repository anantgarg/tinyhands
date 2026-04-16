# Build

How Claude Code should behave when the user clicks "Start Building" on a plan.

## Instructions for Claude Code

1. The calling prompt includes a `Plan file: <path>` suffix. Read that plan file in full before doing anything else.
2. Before starting implementation, pull the latest changes from the main branch into this worktree: `git pull origin <default-branch>`. (Typically `main` or `master` — check which exists.)
3. Edit the plan file directly — do not create a new plan file. As you satisfy each acceptance criterion, tick its checkbox in the plan file.
4. Implement what the plan describes. Follow the plan's own `## Instructions for Claude Code` section for the specifics.
5. When implementation is complete and all acceptance criteria are ticked, update the plan's frontmatter `status:` field to `review`.
