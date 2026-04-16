---
id: plan-004
title: Scan & populate project docs
status: building
created: 2026-04-16
---

## Summary

Scan the codebase and set up the project's development infrastructure. This plan reads the entire project structure, detects the stack, populates documentation, and sets up testing/deployment/linting as needed.

## Instructions for Claude Code

### Step 1: Detect and document (no user input needed)

1. Read the project root to identify the stack:
   - Check for package.json, Podfile, Cargo.toml, go.mod, pyproject.toml, build.gradle, CMakeLists.txt, etc.
   - Identify framework (Next.js, React Native, Electron, Flask, Rails, etc.)
   - Identify language(s), package manager, build tool

2. Populate these files with ACTUAL content from what you find:
   - `.bake/product/vision.md` — infer from README, package.json description, or ask user
   - `.bake/harness/tech-stack.md` — framework, language, build tool, key libraries
   - `.bake/harness/dependencies.md` — parse lock file, list runtime vs dev deps with purpose
   - `.bake/harness/data-model.md` — find interfaces/types/schemas, document core data structures
   - `.bake/product/features.md` — scan for routes/components/modules, create feature index
   - `.bake/harness/preview.md` — fill in the real start command and port
   - `CLAUDE.md` — update @ references to include all created files

3. Write code conventions to `.claude/rules/code-conventions.md`:
   - Detect: TypeScript vs JavaScript, tabs vs spaces, semicolons, import style
   - Detect: component patterns (functional vs class, hooks vs HOCs)
   - Detect: naming conventions from existing code
   - Detect: test patterns if tests exist

### Step 2: Set up infrastructure (ask user for choices)

For each of these, check if it already exists. If not, ask the user whether to set it up:

**Testing:**
- "I found [no tests / Jest tests / etc]. Want me to set up [recommended framework]?"
- If yes: install test deps, create config, write `.bake/harness/testing/strategy.md`, add test script to package.json
- Add rule to `.claude/rules/`: "Write tests for all new features using {framework}. Run tests before every merge."

**Deployment:**
- "I found [no CI / GitHub Actions / Vercel config / Dockerfile / etc]. Want me to set up deployment?"
- If yes: fill in `.bake/harness/deploy.md` with the real deploy steps, and optionally create sub-docs under `.bake/harness/deployment/` (ci-cd.md, infrastructure.md, environment.md) for complex cases — `deploy.md` should link to them.

**API documentation:**
- Only if API routes/handlers exist: "I found API routes. Want me to document the API patterns?"
- If yes: create `.bake/product/api/` with endpoint docs

**Design system:**
- Only if UI components exist: "I found UI components. Want me to document the design patterns?"
- If yes: create `.bake/product/design/` with component/styling docs

### Step 3: Final sync

- Update `CLAUDE.md` with @ references to ALL created files
- Update `.bake/config.yml` with detected project type and settings (particularly `preview.command` and `preview.port_start`)
- Commit all changes

## Acceptance Criteria

- [ ] Tech stack lists the actual framework, language, and build tool
- [ ] Dependencies reflect what's actually installed
- [ ] Data model covers the primary entities used in the codebase
- [ ] Features index is populated
- [ ] Preview command and port are filled in
- [ ] No application code was modified
