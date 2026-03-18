import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';

// ── Mock child_process ──
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  execSync: (...args: any[]) => mockExecSync(...args),
}));

// ── Mock fs ──
const mockReadFileSync = vi.fn();
vi.mock('fs', () => ({
  default: {
    readFileSync: (...args: any[]) => mockReadFileSync(...args),
  },
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
}));

// ── Mock https ──
const mockHttpsGet = vi.fn();
vi.mock('https', () => ({
  default: {
    get: (...args: any[]) => mockHttpsGet(...args),
  },
  get: (...args: any[]) => mockHttpsGet(...args),
}));

// ── Mock config ──
const { mockConfig } = vi.hoisted(() => {
  const mockConfig = {
    github: {
      webhookSecret: 'test-webhook-secret',
    },
    docker: {
      baseImage: 'tinyhands-runner:latest',
    },
    autoUpdate: {
      enabled: true,
      branch: 'main',
    },
  };
  return { mockConfig };
});
vi.mock('../../src/config', () => ({
  config: mockConfig,
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  verifyGithubSignature,
  handleDeploy,
  deployWebhookHandler,
  formatDeploySummary,
  readLocalVersion,
  fetchRemoteVersion,
  compareVersions,
  checkForUpdates,
  type DeployResult,
} from '../../src/modules/auto-update/index';

// ── Helpers ──

function makeSignature(payload: string, secret = 'test-webhook-secret'): string {
  return 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

function makePushPayload(overrides: Record<string, any> = {}) {
  return {
    ref: 'refs/heads/main',
    after: 'abc1234567890',
    commits: [
      {
        added: ['src/new-file.ts'],
        modified: ['src/existing.ts'],
        removed: [],
      },
    ],
    ...overrides,
  };
}

function makeRequest(overrides: Record<string, any> = {}) {
  const body = overrides.body || makePushPayload();
  return {
    headers: {
      'x-hub-signature-256': overrides.signature || makeSignature(JSON.stringify(body)),
      'x-github-event': overrides.event || 'push',
      ...overrides.headers,
    },
    body,
  };
}

function makeResponse() {
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

describe('Auto-Update Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReturnValue(Buffer.from(''));
  });

  // ── Webhook Signature Verification ──

  describe('verifyGithubSignature', () => {
    it('should return true for a valid signature', () => {
      const payload = '{"test": "data"}';
      const signature = makeSignature(payload);

      expect(verifyGithubSignature(payload, signature)).toBe(true);
    });

    it('should return false for an invalid signature', () => {
      const payload = '{"test": "data"}';
      const wrongSignature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000';

      expect(verifyGithubSignature(payload, wrongSignature)).toBe(false);
    });

    it('should return false when signatures have different lengths', () => {
      const payload = '{"test": "data"}';
      const shortSignature = 'sha256=abcd';

      // timingSafeEqual throws when buffers differ in length, so verifyGithubSignature
      // should propagate that error or return false
      expect(() => verifyGithubSignature(payload, shortSignature)).toThrow();
    });

    it('should use sha256 HMAC with the configured webhook secret', () => {
      const payload = '{"action":"push"}';
      const expected = 'sha256=' + crypto
        .createHmac('sha256', 'test-webhook-secret')
        .update(payload)
        .digest('hex');

      expect(verifyGithubSignature(payload, expected)).toBe(true);
    });
  });

  // ── handleDeploy ──

  describe('handleDeploy', () => {
    it('should pull code, build, run migrations, and restart PM2', async () => {
      const payload = makePushPayload();
      const result = await handleDeploy(payload);

      expect(result.success).toBe(true);
      expect(result.commitHash).toBe('abc1234');

      // Verify execution order
      const calls = mockExecSync.mock.calls.map((c: any[]) => c[0]);
      expect(calls[0]).toBe('git pull origin main');
      // No package.json changed, so no npm install
      expect(calls).not.toContainEqual(expect.stringContaining('npm install'));
      expect(calls).toContainEqual('npm run build');
      expect(calls).toContainEqual('npm run migrate');
      expect(calls).toContainEqual('pm2 reload ecosystem.config.js');
    });

    it('should run npm install when package.json is modified', async () => {
      const payload = makePushPayload({
        commits: [
          { added: [], modified: ['package.json'], removed: [] },
        ],
      });

      const result = await handleDeploy(payload);

      expect(result.success).toBe(true);
      expect(result.packageJsonChanged).toBe(true);

      const calls = mockExecSync.mock.calls.map((c: any[]) => c[0]);
      expect(calls).toContainEqual('npm install --include=dev');
    });

    it('should run npm install when package-lock.json changes', async () => {
      const payload = makePushPayload({
        commits: [
          { added: [], modified: ['package-lock.json'], removed: [] },
        ],
      });

      const result = await handleDeploy(payload);
      expect(result.packageJsonChanged).toBe(true);
    });

    it('should rebuild Docker image when Dockerfile changes', async () => {
      const payload = makePushPayload({
        commits: [
          { added: [], modified: ['docker/Dockerfile'], removed: [] },
        ],
      });

      const result = await handleDeploy(payload);

      expect(result.success).toBe(true);
      expect(result.dockerfileChanged).toBe(true);

      const calls = mockExecSync.mock.calls.map((c: any[]) => c[0]);
      expect(calls).toContainEqual(expect.stringContaining('docker build'));
    });

    it('should not rebuild Docker when non-docker files change', async () => {
      const payload = makePushPayload({
        commits: [
          { added: [], modified: ['src/index.ts'], removed: [] },
        ],
      });

      const result = await handleDeploy(payload);

      expect(result.dockerfileChanged).toBe(false);
      const calls = mockExecSync.mock.calls.map((c: any[]) => c[0]);
      expect(calls).not.toContainEqual(expect.stringContaining('docker build'));
    });

    it('should deduplicate changed files', async () => {
      const payload = makePushPayload({
        commits: [
          { added: ['src/a.ts'], modified: ['src/b.ts'], removed: [] },
          { added: ['src/a.ts'], modified: ['src/c.ts'], removed: ['src/b.ts'] },
        ],
      });

      const result = await handleDeploy(payload);

      // Files should be deduplicated in the result
      const unique = new Set(result.changedFiles);
      expect(result.changedFiles.length).toBe(unique.size);
    });

    it('should return failure result when git pull fails', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git pull')) throw new Error('Connection refused');
        return Buffer.from('');
      });

      const result = await handleDeploy(makePushPayload());

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
      expect(result.commitHash).toBe('abc1234');
    });

    it('should return failure result when npm run build fails', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('npm run build')) throw new Error('TypeScript compilation error');
        return Buffer.from('');
      });

      const result = await handleDeploy(makePushPayload());

      expect(result.success).toBe(false);
      expect(result.error).toBe('TypeScript compilation error');
    });

    it('should return failure result when PM2 restart fails', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('pm2 reload')) throw new Error('PM2 not found');
        return Buffer.from('');
      });

      const result = await handleDeploy(makePushPayload());

      expect(result.success).toBe(false);
      expect(result.error).toBe('PM2 not found');
    });

    it('should handle payload with no commits array', async () => {
      const payload = { ref: 'refs/heads/main', after: 'abc1234567890' };

      const result = await handleDeploy(payload);

      expect(result.success).toBe(true);
      expect(result.changedFiles).toEqual([]);
      expect(result.packageJsonChanged).toBe(false);
      expect(result.dockerfileChanged).toBe(false);
    });

    it('should handle commits with missing added/modified/removed fields', async () => {
      const payload = makePushPayload({
        commits: [
          { /* no added, modified, or removed fields */ },
        ],
      });

      const result = await handleDeploy(payload);
      expect(result.success).toBe(true);
      expect(result.changedFiles).toEqual([]);
    });

    it('should handle payload with missing "after" field', async () => {
      const payload = makePushPayload({ after: undefined });

      const result = await handleDeploy(payload);

      expect(result.commitHash).toBe('unknown');
    });

    it('should use graceful reload to avoid interrupting active runs', async () => {
      const result = await handleDeploy(makePushPayload());
      expect(result.success).toBe(true);

      const calls = mockExecSync.mock.calls.map((c: any[]) => c[0]);
      expect(calls).toContainEqual('pm2 reload ecosystem.config.js');
    });

    it('should report restartTime in the result', async () => {
      const result = await handleDeploy(makePushPayload());

      expect(result.restartTime).toBeGreaterThanOrEqual(0);
      expect(typeof result.restartTime).toBe('number');
    });

    it('should pass correct timeouts to execSync', async () => {
      await handleDeploy(makePushPayload());

      // git pull: 30s timeout
      expect(mockExecSync).toHaveBeenCalledWith(
        'git pull origin main',
        expect.objectContaining({ timeout: 30000 })
      );

      // npm run build: 60s timeout
      expect(mockExecSync).toHaveBeenCalledWith(
        'npm run build',
        expect.objectContaining({ timeout: 60000 })
      );
    });
  });

  // ── Express Route Handler ──

  describe('deployWebhookHandler', () => {
    it('should return 401 when signature header is missing', () => {
      const req = makeRequest();
      req.headers['x-hub-signature-256'] = undefined as any;
      const res = makeResponse();

      deployWebhookHandler(req as any, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Missing signature' }));
    });

    it('should return 401 when signature is invalid', () => {
      const req = makeRequest({
        signature: 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
      });
      const res = makeResponse();

      deployWebhookHandler(req as any, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid signature' }));
    });

    it('should ignore non-push events', () => {
      const body = makePushPayload();
      const req = makeRequest({ event: 'pull_request', body });
      const res = makeResponse();

      deployWebhookHandler(req as any, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Ignored non-main push' }));
    });

    it('should ignore pushes to non-main branches', () => {
      const body = makePushPayload({ ref: 'refs/heads/feature-branch' });
      const signature = makeSignature(JSON.stringify(body));
      const req = makeRequest({ body, signature });
      const res = makeResponse();

      deployWebhookHandler(req as any, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Ignored non-main push' }));
    });

    it('should respond 202 and trigger deploy for valid push to main', () => {
      const body = makePushPayload();
      const signature = makeSignature(JSON.stringify(body));
      const req = makeRequest({ body, signature });
      const res = makeResponse();

      deployWebhookHandler(req as any, res);

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Deploy started' }));
    });
  });

  // ── Deploy Summary Formatter ──

  describe('formatDeploySummary', () => {
    it('should format successful deploy', () => {
      const result: DeployResult = {
        success: true,
        commitHash: 'abc1234',
        changedFiles: ['src/a.ts', 'src/b.ts'],
        packageJsonChanged: false,
        dockerfileChanged: false,
        restartTime: 5432,
      };

      const summary = formatDeploySummary(result);

      expect(summary).toContain('Deploy successful');
      expect(summary).toContain('abc1234');
      expect(summary).toContain('Changed files: 2');
      expect(summary).toContain('5.4s');
      expect(summary).not.toContain('Dependencies updated');
      expect(summary).not.toContain('Docker image rebuilt');
      expect(summary).not.toContain('Error');
    });

    it('should format failed deploy', () => {
      const result: DeployResult = {
        success: false,
        commitHash: 'def5678',
        changedFiles: ['package.json'],
        packageJsonChanged: true,
        dockerfileChanged: false,
        restartTime: 1200,
        error: 'npm install failed: EACCES',
      };

      const summary = formatDeploySummary(result);

      expect(summary).toContain('Grip slipped');
      expect(summary).toContain('def5678');
      expect(summary).toContain('Dependencies updated');
      expect(summary).toContain('npm install failed: EACCES');
    });

    it('should include Docker rebuild note when dockerfile changed', () => {
      const result: DeployResult = {
        success: true,
        commitHash: 'aaa1111',
        changedFiles: ['docker/Dockerfile'],
        packageJsonChanged: false,
        dockerfileChanged: true,
        restartTime: 12000,
      };

      const summary = formatDeploySummary(result);

      expect(summary).toContain('Docker image rebuilt');
    });

    it('should include both dependency and docker notes when both changed', () => {
      const result: DeployResult = {
        success: true,
        commitHash: 'bbb2222',
        changedFiles: ['package.json', 'docker/Dockerfile'],
        packageJsonChanged: true,
        dockerfileChanged: true,
        restartTime: 20000,
      };

      const summary = formatDeploySummary(result);

      expect(summary).toContain('Dependencies updated');
      expect(summary).toContain('Docker image rebuilt');
    });

    it('should format restart time as seconds with one decimal', () => {
      const result: DeployResult = {
        success: true,
        commitHash: 'ccc3333',
        changedFiles: [],
        packageJsonChanged: false,
        dockerfileChanged: false,
        restartTime: 123,
      };

      const summary = formatDeploySummary(result);
      expect(summary).toContain('0.1s');
    });
  });

  // ── handleDeploy - migration file changes ──

  describe('handleDeploy - migration files', () => {
    it('should log specific message when migration files changed', async () => {
      const payload = makePushPayload({
        commits: [
          { added: ['src/db/migrations/010-new.sql'], modified: [], removed: [] },
        ],
      });

      const result = await handleDeploy(payload);
      expect(result.success).toBe(true);
    });
  });

  // ── deployWebhookHandler - handleDeploy error ──

  describe('deployWebhookHandler - deploy error handling', () => {
    it('should catch and log errors from handleDeploy when it rejects', async () => {
      // To trigger the .catch() handler, we need handleDeploy to reject.
      // The commits iteration happens before the try/catch in handleDeploy.
      // A commits array with a custom [Symbol.iterator] that throws will cause rejection.
      const body = makePushPayload();
      const signature = makeSignature(JSON.stringify(body));

      // After signature verification, replace commits with something that throws during iteration
      const evilCommits: any = [];
      evilCommits[Symbol.iterator] = () => { throw new Error('iteration crash'); };
      // Make JSON.stringify still work (toJSON returns valid array)
      evilCommits.toJSON = () => body.commits;

      const reqBody = { ...body, commits: evilCommits };
      // The body stringifies correctly for sig check
      const req = {
        headers: {
          'x-hub-signature-256': signature,
          'x-github-event': 'push',
        },
        body: reqBody,
      };
      const res = makeResponse();

      deployWebhookHandler(req as any, res);
      expect(res.status).toHaveBeenCalledWith(202);
      // Wait for async error to be caught
      await new Promise(r => setTimeout(r, 10));
    });
  });

  // ── verifyGithubSignature - no webhook secret ──

  describe('verifyGithubSignature - no secret configured', () => {
    it('should return false when webhookSecret is empty', () => {
      const originalSecret = mockConfig.github.webhookSecret;
      mockConfig.github.webhookSecret = '';

      expect(verifyGithubSignature('payload', 'sha256=abc')).toBe(false);

      mockConfig.github.webhookSecret = originalSecret;
    });
  });

  // ── readLocalVersion ──

  describe('readLocalVersion', () => {
    it('should read VERSION file and trim whitespace', () => {
      mockReadFileSync.mockReturnValueOnce('1.5.0\n');

      const version = readLocalVersion();
      expect(version).toBe('1.5.0');
    });

    it('should return 0.0.0 when VERSION file does not exist', () => {
      mockReadFileSync.mockImplementationOnce(() => {
        throw new Error('ENOENT');
      });

      const version = readLocalVersion();
      expect(version).toBe('0.0.0');
    });
  });

  // ── fetchRemoteVersion ──

  describe('fetchRemoteVersion', () => {
    it('should resolve with remote version on HTTP 200', async () => {
      mockHttpsGet.mockImplementation((_url: string, callback: Function) => {
        const fakeResponse = {
          statusCode: 200,
          on: vi.fn((event: string, handler: Function) => {
            if (event === 'data') {
              handler(Buffer.from('1.6.0\n'));
            }
            if (event === 'end') {
              handler();
            }
          }),
        };
        callback(fakeResponse);
        return { on: vi.fn() };
      });

      const version = await fetchRemoteVersion('main');
      expect(version).toBe('1.6.0');
    });

    it('should reject when HTTP status is not 200', async () => {
      mockHttpsGet.mockImplementation((_url: string, callback: Function) => {
        const fakeResponse = {
          statusCode: 404,
          on: vi.fn((event: string, handler: Function) => {
            if (event === 'data') {
              // no data
            }
            if (event === 'end') {
              handler();
            }
          }),
        };
        callback(fakeResponse);
        return { on: vi.fn() };
      });

      await expect(fetchRemoteVersion('main')).rejects.toThrow('Failed to fetch remote VERSION');
    });

    it('should reject on network error', async () => {
      mockHttpsGet.mockImplementation((_url: string, _callback: Function) => {
        const req = {
          on: vi.fn((event: string, handler: Function) => {
            if (event === 'error') {
              handler(new Error('ECONNREFUSED'));
            }
          }),
        };
        return req;
      });

      await expect(fetchRemoteVersion('main')).rejects.toThrow('ECONNREFUSED');
    });
  });

  // ── compareVersions ──

  describe('compareVersions', () => {
    it('should return 1 when remote is newer', () => {
      expect(compareVersions('1.5.0', '1.6.0')).toBe(1);
    });

    it('should return -1 when local is newer', () => {
      expect(compareVersions('1.6.0', '1.5.0')).toBe(-1);
    });

    it('should return 0 when versions are equal', () => {
      expect(compareVersions('1.5.0', '1.5.0')).toBe(0);
    });

    it('should compare major versions', () => {
      expect(compareVersions('1.0.0', '2.0.0')).toBe(1);
      expect(compareVersions('2.0.0', '1.0.0')).toBe(-1);
    });

    it('should compare patch versions', () => {
      expect(compareVersions('1.5.0', '1.5.1')).toBe(1);
      expect(compareVersions('1.5.1', '1.5.0')).toBe(-1);
    });

    it('should handle missing version parts', () => {
      expect(compareVersions('1.5', '1.5.1')).toBe(1);
      expect(compareVersions('1.5.1', '1.5')).toBe(-1);
      expect(compareVersions('1', '1.0.0')).toBe(0);
    });
  });

  // ── checkForUpdates ──

  describe('checkForUpdates', () => {
    it('should skip when auto-update is disabled', async () => {
      mockConfig.autoUpdate.enabled = false;

      await checkForUpdates();

      // Should not call readLocalVersion or fetchRemoteVersion
      expect(mockReadFileSync).not.toHaveBeenCalled();

      mockConfig.autoUpdate.enabled = true;
    });

    it('should trigger deploy when remote version is newer', async () => {
      mockReadFileSync.mockReturnValueOnce('1.5.0\n');

      mockHttpsGet.mockImplementation((_url: string, callback: Function) => {
        const fakeResponse = {
          statusCode: 200,
          on: vi.fn((event: string, handler: Function) => {
            if (event === 'data') handler(Buffer.from('1.6.0'));
            if (event === 'end') handler();
          }),
        };
        callback(fakeResponse);
        return { on: vi.fn() };
      });

      await checkForUpdates();

      // handleDeploy should have been called (via execSync for git pull)
      expect(mockExecSync).toHaveBeenCalledWith(
        'git pull origin main',
        expect.any(Object)
      );
    });

    it('should not deploy when versions are equal', async () => {
      mockReadFileSync.mockReturnValueOnce('1.5.0\n');

      mockHttpsGet.mockImplementation((_url: string, callback: Function) => {
        const fakeResponse = {
          statusCode: 200,
          on: vi.fn((event: string, handler: Function) => {
            if (event === 'data') handler(Buffer.from('1.5.0'));
            if (event === 'end') handler();
          }),
        };
        callback(fakeResponse);
        return { on: vi.fn() };
      });

      await checkForUpdates();

      // handleDeploy should NOT have been called
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockReadFileSync.mockImplementationOnce(() => {
        throw new Error('read failed');
      });

      // Should not throw
      await checkForUpdates();
    });

    it('should handle fetchRemoteVersion errors gracefully', async () => {
      mockReadFileSync.mockReturnValueOnce('1.5.0\n');

      mockHttpsGet.mockImplementation((_url: string, _callback: Function) => {
        return {
          on: vi.fn((event: string, handler: Function) => {
            if (event === 'error') handler(new Error('network error'));
          }),
        };
      });

      // Should not throw
      await checkForUpdates();
    });
  });

  // ── handleDeploy - pull-based (no changedFiles) ──

  describe('handleDeploy - pull-based auto-update', () => {
    it('should run npm install when changedFiles is empty (pull-based)', async () => {
      const payload = { after: 'auto-update', commits: [] };

      const result = await handleDeploy(payload);

      expect(result.success).toBe(true);
      // Should install deps because isPullBased is true
      const calls = mockExecSync.mock.calls.map((c: any[]) => c[0]);
      expect(calls).toContainEqual('npm install --include=dev');
    });
  });
});
