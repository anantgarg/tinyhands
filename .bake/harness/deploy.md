# Deploy

Steps to deploy TinyHands to production. This is the single entry point the Deploy button reads — Claude Code follows whatever is written here.

## Deploy Target

A single Linux host running PM2 directly on the host (not Docker Compose for the app) with 6 processes: listener, workers ×3, scheduler, sync. System nginx reverse-proxies `127.0.0.1:3000`. Let's Encrypt via certbot, renewed automatically. Cloudflare proxies the primary domain to the origin.

**Host-specific values** (droplet name, public IP, SSH key path, app checkout directory, primary domain, admin email for certbot) are kept out of this public repo. Claude Code resolves them from the operator's private environment — in this project, user memory at `~/.claude/projects/-Users-anantgarg-Local-tinyhands/memory/reference_digitalocean.md`. When shown placeholders like `$DROPLET`, `$APP_DIR`, or `$ADMIN_EMAIL` below, substitute from that reference before running.

## Instructions for Claude Code

1. Ensure you are on `main` in the main project checkout (not a worktree). If not, switch before proceeding.
2. Run the Pre-deploy Checklist.
3. Run the Deploy Steps in order.
4. On success, append a release entry to `.bake/product/releases.md` per the Post-deploy format below, and tag a GitHub release via `gh release create`.
5. If anything fails mid-deploy, stop and surface the error — do not retry destructively.

## Pre-deploy Checklist

- [ ] On `main`, working tree clean (or only `VERSION` + `package.json` about to be bumped).
- [ ] All commits that should ship are on `main` locally.
- [ ] `npm test` passes locally (husky pre-commit enforces this). Rarely-flaky tests (e.g. `api-kb.test.ts > DELETE /kb/sources/:id`) can be re-run; pre-existing flakiness is fine, a consistent failure is a stop-ship.
- [ ] Decide the version bump (see `CLAUDE.md` → Versioning). Patch for bug fixes, minor for new features, major for breaking changes.

## Deploy Steps

### 1. Bump version and push

```bash
# Bump both files to the same value (auto-update reads VERSION, package.json drives releases)
echo "1.X.Y" > VERSION
# Edit package.json "version" to the same value
git add VERSION package.json
git commit -m "Bump version to v1.X.Y"  # husky runs full test suite
git push origin main
```

### 2. Deploy to host

Substitute `$DROPLET`, `$SSH_KEY`, `$APP_DIR` from user memory. The one-shot command:

```bash
doctl compute ssh $DROPLET --ssh-key-path $SSH_KEY --ssh-command "cd $APP_DIR && git checkout -- package-lock.json web/tsconfig.tsbuildinfo 2>/dev/null; git pull origin main && NODE_ENV=development npm install && cd web && NODE_ENV=development npm install && cd .. && NODE_ENV=development npm run build && NODE_ENV=development npm run build:web && npm run migrate && pm2 reload ecosystem.config.js --force"
```

Notes:
- `NODE_ENV=development` during install/build is intentional — TypeScript, Vite, and `@types/*` are devDependencies. PM2 sets `NODE_ENV=production` at runtime regardless.
- The initial `git checkout -- …` discards regeneratable drift in `package-lock.json` / `web/tsconfig.tsbuildinfo` that can accumulate from local `npm install` runs. Never discard other files without checking — untracked files in `$APP_DIR` may be pre-existing operator state.
- If the pull fails with "local changes would be overwritten" on other files, inspect with `git status` and decide file by file — do not blanket-discard.
- Migrations are idempotent; running `npm run migrate` when nothing is pending is safe and fast.
- `pm2 reload --force` does a graceful per-process reload (SIGTERM → wait for shutdown → start new), so in-flight agent runs complete cleanly. Use `--update-env` if you changed `.env`.

### 3. Verify

```bash
# App health from outside Cloudflare
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' https://$PRIMARY_DOMAIN/

# From host: listener port + PM2 versions
doctl compute ssh $DROPLET --ssh-key-path $SSH_KEY --ssh-command "curl -sS -o /dev/null -w 'origin-local HTTP %{http_code}\n' http://127.0.0.1:3000/ && pm2 list | grep tinyhands"
```

Every process should show the new version in the `version` column. External HTTP should be 200. If Cloudflare returns 522, Cloudflare cannot reach origin — check the zone's DNS records point to the droplet's origin IP and that the proxy setting is working (both CF Universal SSL and Full SSL mode have historically worked against this origin).

## Environment changes

`.env` lives at `$APP_DIR/.env`. Bump a value with `sed -i` + `pm2 reload ecosystem.config.js --update-env` (NB: `pm2 reload all --update-env` does NOT re-parse the ecosystem file, so values cached at PM2 start time won't refresh):

```bash
doctl compute ssh $DROPLET --ssh-key-path $SSH_KEY --ssh-command "cd $APP_DIR && cp .env .env.bak-\$(date +%Y%m%d-%H%M%S) && sed -i 's|^KEY=.*|KEY=newvalue|' .env && pm2 reload ecosystem.config.js --update-env"
```

## Domain changes

To add a new domain (e.g. a new tenant subdomain):

1. Ensure Cloudflare DNS has an A/AAAA record for the domain pointing to the droplet's origin IP.
2. Create `/etc/nginx/sites-available/<domain>` with both a port-80 block (serving `/.well-known/acme-challenge/` from `/var/www/html` + 301 to HTTPS) and a port-443 block (proxy_pass `http://127.0.0.1:3000`, set the proxy_* headers, large proxy_buffers).
3. Symlink it into `/etc/nginx/sites-enabled/`.
4. `nginx -t && systemctl reload nginx`.
5. `certbot --nginx -d <domain> --non-interactive --agree-tos --email $ADMIN_EMAIL`. Certbot may leave a broken redirect loop inside the 443 block — re-check the config afterwards.
6. If this becomes the new primary OAuth domain, update `OAUTH_REDIRECT_BASE_URL` in `.env` and `pm2 reload ecosystem.config.js --update-env`. Update OAuth redirect URIs in Slack, Google Cloud Console, Notion, and GitHub OAuth apps by hand — those live in third-party dashboards.

## Rollback

Code rollback (safe at any time; migrations are additive):

```bash
doctl compute ssh $DROPLET --ssh-key-path $SSH_KEY --ssh-command "cd $APP_DIR && git checkout vX.Y.Z && NODE_ENV=development npm install && NODE_ENV=development npm run build && NODE_ENV=development npm run build:web && pm2 reload ecosystem.config.js --force"
```

If a migration itself is the problem, write a new compensating migration and ship it as a new version — do not hand-edit the `migrations` table.

## Post-deploy

1. `gh release create vX.Y.Z --title "…" --notes "…"` — notes should summarize merges since the previous release (read `.bake/product/changelog.md`) and include the exact rollback command.
2. Append a matching entry to `.bake/product/releases.md`:

```
## {version} — {YYYY-MM-DD}

Deployed to DigitalOcean droplet `tinyjobs-prod` (45.55.157.4). Includes:
- {one-line summary per merge since the previous release}
- ...

Rollback: `{exact command}`
```

See `.bake/product/releases.md` for the full history.

## Auto-update (currently disabled)

`src/modules/auto-update/index.ts` can pull-deploy on VERSION changes when `AUTO_UPDATE_ENABLED=true`. Production has this off — deploys are manual via the steps above. If re-enabling: bump `VERSION` alongside `package.json` on every commit that should ship (they must match), otherwise pull-based auto-update drifts silently (the `VERSION` file drifted behind `package.json` for several releases before auto-update was turned off).

## Related Docs

- `.bake/harness/deployment/ci-cd.md` — CI rules (if/when we add a CI pipeline)
- `.bake/harness/deployment/infrastructure.md` — droplet provisioning, PM2 ecosystem, nginx base config
- `.bake/harness/deployment/environment.md` — full environment variable reference
