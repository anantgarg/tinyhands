# Deploy

Steps to deploy this project to its production environment. This is the single entry point the Deploy button reads — Claude Code follows whatever is written here.

> ⚠️ This file is a stub. The setup plan (scan or define-your-product) will fill it in with real steps based on your project's stack and deployment target. Until then, clicking Deploy will ask you how you want to deploy.

## Instructions for Claude Code

1. Ensure you are on the `main` branch of the main project checkout (not a worktree). If not, switch before proceeding.
2. Follow the Pre-deploy Checklist and Deploy Steps below in order.
3. If this file is a stub and no deploy steps are configured, ask the user how they want to deploy before proceeding.
4. After a successful deploy, append a release entry to `.bake/product/releases.md` per the Post-deploy format below.

## Pre-deploy Checklist

- [ ] All tests pass (see `.bake/harness/testing/strategy.md` if it exists)
- [ ] `merge.md` has been run for any in-flight session branches
- [ ] No uncommitted changes on the main branch

## Deploy Target

_(describe where this project deploys — e.g., Vercel, Fly.io, Railway, GitHub Pages, TestFlight, Cloud Run. Include the environment name and region if relevant.)_

## Steps

1. _(first deploy step — e.g., `npm run build`)_
2. _(second deploy step — e.g., `vercel --prod`)_
3. _(verification step — e.g., curl the health endpoint, check the release dashboard)_

## Rollback

_(how to revert a bad deploy — e.g., "redeploy the previous git tag with `vercel rollback`", "`fly releases rollback <version>`", "restore the previous Cloud Run revision")_

## Post-deploy

After a successful deploy, append a release entry to `.bake/product/releases.md` with:

- Version tag or commit SHA that was deployed
- Deploy date (ISO format)
- A bulleted list of merges since the previous release (read `.bake/product/changelog.md` for the per-merge history and summarize entries since the previous release entry)
- The exact rollback command to use if this release needs to be reverted

Format:

```
## {version} — {YYYY-MM-DD}

Deployed to {target}. Includes:
- {one-line summary per merge since the previous release}
- ...

Rollback: `{exact command}`
```

See `.bake/product/releases.md` for the full history.

## Related Docs

If this project's deployment is complex enough to warrant splitting details out, link to them here. The scan plan creates these only when needed — don't create empty files:

- `.bake/harness/deployment/ci-cd.md` — CI/CD pipeline rules (what runs on push, merge, tag)
- `.bake/harness/deployment/infrastructure.md` — hosting, CDN, database provisioning
- `.bake/harness/deployment/environment.md` — environment variables, secrets, service config
