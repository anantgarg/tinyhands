import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { execSync } from 'child_process';
import type { Request, Response } from 'express';
import { config } from '../../config';
import { logger } from '../../utils/logger';

// ── Webhook Signature Verification ──

export function verifyGithubSignature(payload: string, signature: string): boolean {
  if (!config.github.webhookSecret) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', config.github.webhookSecret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// ── Deploy Handler ──

export interface DeployResult {
  success: boolean;
  commitHash: string;
  changedFiles: string[];
  packageJsonChanged: boolean;
  dockerfileChanged: boolean;
  restartTime: number;
  error?: string;
}

export async function handleDeploy(payload: any): Promise<DeployResult> {
  const startTime = Date.now();
  const commitHash = payload.after?.slice(0, 7) || 'unknown';

  // Get changed files
  const changedFiles: string[] = [];
  if (payload.commits) {
    for (const commit of payload.commits) {
      changedFiles.push(...(commit.added || []), ...(commit.modified || []), ...(commit.removed || []));
    }
  }

  const packageJsonChanged = changedFiles.includes('package.json') || changedFiles.includes('package-lock.json');
  const dockerfileChanged = changedFiles.some((f: string) => f.startsWith('docker/'));

  try {
    // 1. Git pull
    logger.info('Deploy: pulling latest code', { commitHash });
    execSync('git pull origin main', { cwd: process.cwd(), timeout: 30000 });

    // 2. npm install if package.json changed or pull-based (no changedFiles info)
    // --include=dev is required because NODE_ENV=production (from .env) causes npm
    // to skip devDependencies, but tsc needs @types/* packages to compile
    const isPullBased = changedFiles.length === 0;
    if (packageJsonChanged || isPullBased) {
      logger.info('Deploy: installing dependencies');
      execSync('npm install --include=dev', { cwd: process.cwd(), timeout: 120000 });
    }

    // 3. Docker rebuild if Dockerfile changed
    if (dockerfileChanged) {
      logger.info('Deploy: rebuilding Docker image');
      execSync(`docker build -t ${config.docker.baseImage} ./docker/`, {
        cwd: process.cwd(),
        timeout: 300000,
      });
    }

    // 4. Build TypeScript
    logger.info('Deploy: building TypeScript');
    execSync('npm run build', { cwd: process.cwd(), timeout: 60000 });

    // 4.5. Run database migrations
    const migrationChanged = changedFiles.some((f: string) => f.includes('migrations/'));
    if (migrationChanged) {
      logger.info('Deploy: running database migrations (migration files changed)');
    } else {
      logger.info('Deploy: running database migrations');
    }
    execSync('npm run migrate', { cwd: process.cwd(), timeout: 60000 });

    // 5. Graceful reload — sends SIGTERM to each process one at a time,
    // waits for it to exit (allowing active agent runs to finish), then starts the new version.
    // This prevents orphaned Docker containers from interrupted runs.
    logger.info('Deploy: graceful reload via PM2');
    execSync('pm2 reload ecosystem.config.js', { cwd: process.cwd(), timeout: 120000 });

    const restartTime = Date.now() - startTime;

    logger.info('Deploy completed', {
      commitHash,
      changedFiles: changedFiles.length,
      packageJsonChanged,
      dockerfileChanged,
      restartTime,
    });

    return {
      success: true,
      commitHash,
      changedFiles: [...new Set(changedFiles)],
      packageJsonChanged,
      dockerfileChanged,
      restartTime,
    };
  } catch (err: any) {
    logger.error('Deploy failed', { commitHash, error: err.message });
    return {
      success: false,
      commitHash,
      changedFiles: [...new Set(changedFiles)],
      packageJsonChanged,
      dockerfileChanged,
      restartTime: Date.now() - startTime,
      error: err.message,
    };
  }
}

// ── Express Route Handler ──

export function deployWebhookHandler(req: Request, res: Response): void {
  const signature = req.headers['x-hub-signature-256'] as string;
  const event = req.headers['x-github-event'] as string;

  if (!signature) {
    res.status(401).json({ error: 'Missing signature' });
    return;
  }

  const payload = JSON.stringify(req.body);
  if (!verifyGithubSignature(payload, signature)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // Only deploy on push to main
  if (event !== 'push' || req.body.ref !== 'refs/heads/main') {
    res.status(200).json({ message: 'Ignored non-main push' });
    return;
  }

  // Respond immediately, deploy async
  res.status(202).json({ message: 'Deploy started' });

  handleDeploy(req.body).catch(err => {
    logger.error('Deploy handler error', { error: err.message });
  });
}

// ── Pull-Based Auto-Update ──

export function readLocalVersion(): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), 'VERSION'), 'utf-8').trim();
  } catch {
    return '0.0.0';
  }
}

export function fetchRemoteVersion(branch: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = `https://raw.githubusercontent.com/anantgarg/tinyhands/${branch}/VERSION`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data.trim());
        } else {
          reject(new Error(`Failed to fetch remote VERSION: HTTP ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

export function compareVersions(local: string, remote: string): number {
  const localParts = local.split('.').map(Number);
  const remoteParts = remote.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const l = localParts[i] || 0;
    const r = remoteParts[i] || 0;
    if (r > l) return 1;
    if (r < l) return -1;
  }
  return 0;
}

export async function checkForUpdates(): Promise<void> {
  if (!config.autoUpdate.enabled) return;

  try {
    const localVersion = readLocalVersion();
    const remoteVersion = await fetchRemoteVersion(config.autoUpdate.branch);

    if (compareVersions(localVersion, remoteVersion) > 0) {
      logger.info('Auto-update: new version available', { local: localVersion, remote: remoteVersion });
      await handleDeploy({ after: 'auto-update', commits: [] });
    }
  } catch (err: any) {
    logger.error('Auto-update check failed', { error: err.message });
  }
}

// ── Deploy Summary for Slack ──

export function formatDeploySummary(result: DeployResult): string {
  const status = result.success ? ':white_check_mark: Deploy successful' : ':open_hands: Oops. Grip slipped on this deploy';

  let summary = `${status}\n`;
  summary += `Commit: \`${result.commitHash}\`\n`;
  summary += `Changed files: ${result.changedFiles.length}\n`;

  if (result.packageJsonChanged) summary += ':package: Dependencies updated\n';
  if (result.dockerfileChanged) summary += ':whale: Docker image rebuilt\n';

  summary += `Restart time: ${(result.restartTime / 1000).toFixed(1)}s\n`;

  if (result.error) {
    summary += `\n:warning: Error: ${result.error}\n`;
  }

  return summary;
}
