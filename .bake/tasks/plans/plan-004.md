---
id: plan-004
title: Fix Create Trigger button not working on Agent Detail page
status: in_progress
created: 2026-04-16
---

## Summary

The "Create Trigger" button on the Agent Detail → Triggers tab was non-functional. Clicking it appeared to do nothing because the frontend was sending the API request to the wrong endpoint.

## Why

Gaurav reported being unable to create triggers from the dashboard. The "Add Trigger" dialog opens correctly and the form is usable, but clicking "Create Trigger" silently fails because the API call hits a non-existent route.

## Approach

The `useAddAgentTrigger` hook was posting to `POST /agents/{id}/triggers`, but the backend only defines a `GET` handler at that path (for listing triggers). The actual creation endpoint is `POST /triggers` in the triggers router, which expects `agentId` in the request body. Fixed by redirecting the API call to the correct endpoint.

## Instructions for Claude Code

1. In `web/src/api/agents.ts`, change the `useAddAgentTrigger` mutation to post to `/triggers` with `agentId` in the body instead of `/agents/${agentId}/triggers`.

As you complete each acceptance criterion below, edit this plan file and tick `- [ ]` → `- [x]` for the criteria you've satisfied. Do this as you go, not only at the very end — small honest updates beat one big sweep. If a criterion cannot be satisfied as written (ambiguous, wrong, or blocked), leave it unchecked and add a one-line note below it explaining why.

## Test Plan

- [ ] Click "+ Add Trigger" on an agent's Triggers tab, fill in the schedule form, click "Create Trigger" — should succeed and show the new trigger in the list
- [ ] Verify webhook and other trigger types also create successfully
- [ ] Verify existing triggers still load correctly (GET endpoint unchanged)

## Acceptance Criteria

- [x] `useAddAgentTrigger` posts to `POST /triggers` with `agentId` in the body
- [ ] Creating a schedule trigger from the Agent Detail page succeeds
- [ ] Creating a webhook trigger from the Agent Detail page succeeds
- [ ] Existing trigger listing on Agent Detail page still works

## Out of Scope

- Refactoring the standalone Triggers page (`web/src/pages/Triggers.tsx`) — it already uses the correct `useCreateTrigger` hook that posts to `/triggers`.
- Adding a `POST /agents/:id/triggers` backend route — unnecessary when the `/triggers` endpoint already handles creation.
