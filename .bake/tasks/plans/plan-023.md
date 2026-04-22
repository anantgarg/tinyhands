---
id: plan-023
title: New Plan
status: draft
created: 2026-04-22
---

## Summary

A plain-language description of what this plan does and why it matters. No file paths, no code, no jargon.

## Why

Why does this change matter? What prompted it — a user request, an incident, a constraint? Future-you will want this context when reviewing the plan months later.

## Approach

How will this be implemented? Which areas of the codebase are affected, what architectural decisions are involved, and what trade-offs are we making? A developer reading this should understand the shape of the work without needing to see line-by-line code instructions.

## Instructions for Claude Code

Step-by-step instructions detailed enough that an engineer (human or AI) who has never seen this codebase could implement the plan. Link to specific files and line numbers where possible. Call out non-obvious constraints, edge cases, and "do not touch" zones.

As you complete each acceptance criterion below, edit this plan file and tick `- [ ]` → `- [x]` for the criteria you've satisfied. Do this as you go, not only at the very end — small honest updates beat one big sweep. If a criterion cannot be satisfied as written (ambiguous, wrong, or blocked), leave it unchecked and add a one-line note below it explaining why.

## Test Plan

- [ ] What to test manually — describe the UI flow, expected behavior, and how to verify it works
- [ ] What edge cases to check — unusual inputs, empty states, error scenarios
- [ ] What regressions to watch for — existing features that could break

## Acceptance Criteria

- [ ] First concrete, checkable outcome
- [ ] Second concrete, checkable outcome
- [ ] Third concrete, checkable outcome (three minimum — forces thinking about more than the happy path)

## Out of Scope

What this plan will deliberately NOT do. Prevents scope creep during implementation and makes it clear to reviewers that omissions are intentional, not oversights.
