# Releases

One entry per deploy to production. Each entry names the version, the date, the merges included since the previous release, and the exact rollback command. Updated automatically by the Deploy button (see `.bake/harness/deploy.md` for the post-deploy step that appends here).

## v1.47.0 — 2026-04-17

Deployed to DigitalOcean droplet `tinyjobs-prod` (45.55.157.4). Includes:

- plan-010 merged: multi-tenant workspaces — Sign in with Slack, per-workspace Anthropic API keys (encrypted + validated), workspace switcher, Slack OAuth install flow, workspace-scoped Redis/webhooks/OAuth state, per-run container isolation, platform-admin health view, idempotent single-tenant → multi-tenant migration
- Domain swap: OAuth redirect base is now `https://app.tinyhands.ai` (previously `cometchat.tinyhands.ai` — left active for OAuth URLs registered with third parties that haven't been updated yet)
- New Let's Encrypt cert for `app.tinyhands.ai` installed on origin
- Migration `024_multitenant.sql` applied
- Bundles every prior unreleased merge since v1.46.3 (ship-readiness audit + bake project file updates)

Rollback: `doctl compute ssh tinyjobs-prod --ssh-key-path ~/.ssh/tinyjobs_deploy --ssh-command "cd /root/tinyjobs && git checkout v1.46.3 && NODE_ENV=development npm install && NODE_ENV=development npm run build && NODE_ENV=development npm run build:web && pm2 reload ecosystem.config.js --force"`  (migration 024 is additive — safe to leave applied; code rollback alone is sufficient)

## v1.46.3 — 2026-04-16

- Fix Create Trigger button on Agent Detail page

Rollback: `git checkout v1.46.2 -- . && git commit -m "Rollback to v1.46.2" && git push`
