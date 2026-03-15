import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──
// vi.hoisted ensures these are available when vi.mock factories run (which are hoisted above imports)

const {
  mockContainerStart,
  mockContainerWait,
  mockContainerRemove,
  mockContainerAttach,
  mockContainerLogs,
  mockContainerKill,
  mockCreateContainer,
  mockDemuxStream,
  mockListContainers,
  mockBuildImage,
  mockFollowProgress,
} = vi.hoisted(() => {
  const mockContainerStart = vi.fn();
  const mockContainerWait = vi.fn().mockResolvedValue({ StatusCode: 0 });
  const mockContainerRemove = vi.fn();
  const mockContainerAttach = vi.fn();
  const mockContainerLogs = vi.fn();
  const mockContainerKill = vi.fn();

  const mockCreateContainer = vi.fn().mockResolvedValue({
    id: 'container-123',
    start: mockContainerStart,
    wait: mockContainerWait,
    remove: mockContainerRemove,
    attach: mockContainerAttach,
    logs: mockContainerLogs,
    kill: mockContainerKill,
  });

  const mockDemuxStream = vi.fn();
  const mockListContainers = vi.fn().mockResolvedValue([]);
  const mockBuildImage = vi.fn();
  const mockFollowProgress = vi.fn();

  return {
    mockContainerStart,
    mockContainerWait,
    mockContainerRemove,
    mockContainerAttach,
    mockContainerLogs,
    mockContainerKill,
    mockCreateContainer,
    mockDemuxStream,
    mockListContainers,
    mockBuildImage,
    mockFollowProgress,
  };
});

vi.mock('dockerode', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      createContainer: mockCreateContainer,
      modem: { demuxStream: mockDemuxStream, followProgress: mockFollowProgress },
      listContainers: mockListContainers,
      buildImage: mockBuildImage,
    })),
  };
});

vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    chownSync: vi.fn(),
    chmodSync: vi.fn(),
  },
}));

vi.mock('../../src/config', () => ({
  config: {
    docker: { baseImage: 'tinyhands-runner:latest', defaultCpu: 1, defaultMemory: 2048 },
    anthropic: { apiKey: 'test-key' },
  },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createAgentContainer,
  startContainer,
  waitForContainer,
  removeContainer,
  getContainerLogs,
  followContainerOutput,
  buildBaseImage,
  listAgentContainers,
} from '../../src/docker';

import type { ContainerConfig } from '../../src/docker';
import type { Agent } from '../../src/types';
import fs from 'fs';

// ── Helpers ──

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'test-agent',
    channel_id: 'C123',
    channel_ids: ['C123'],
    system_prompt: 'You are a test agent',
    tools: [],
    avatar_emoji: ':robot_face:',
    status: 'active',
    model: 'sonnet',
    streaming_detail: false,
    docker_image: null,
    self_evolution_mode: 'approve-first',
    max_turns: 10,
    memory_enabled: false,
    respond_to_all_messages: false,
    relevance_keywords: [],
    created_by: 'U001',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeContainerConfig(overrides: Partial<ContainerConfig> = {}): ContainerConfig {
  return {
    agent: makeAgent(),
    traceId: 'trace-123',
    workingDir: '/tmp/tinyhands-workspaces/agent-1',
    envVars: {
      SYSTEM_PROMPT: 'You are a test agent',
      TASK_PROMPT: 'Do something',
      MODEL: 'claude-sonnet-4-20250514',
      MAX_TURNS: '10',
    },
    ...overrides,
  };
}

// ── Tests ──

describe('Docker Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore the default happy-path mock after each test
    mockContainerWait.mockResolvedValue({ StatusCode: 0 });
    mockCreateContainer.mockResolvedValue({
      id: 'container-123',
      start: mockContainerStart,
      wait: mockContainerWait,
      remove: mockContainerRemove,
      attach: mockContainerAttach,
      logs: mockContainerLogs,
      kill: mockContainerKill,
    });
  });

  // ────────────────────────────────────────────
  // createAgentContainer
  // ────────────────────────────────────────────

  describe('createAgentContainer', () => {
    it('should create a container with the correct image', async () => {
      const cfg = makeContainerConfig();
      await createAgentContainer(cfg);

      expect(mockCreateContainer).toHaveBeenCalledTimes(1);
      const createOpts = mockCreateContainer.mock.calls[0][0];
      expect(createOpts.Image).toBe('tinyhands-runner:latest');
    });

    it('should use agent.docker_image when specified', async () => {
      const cfg = makeContainerConfig({
        agent: makeAgent({ docker_image: 'custom-image:v2' }),
      });
      await createAgentContainer(cfg);

      const createOpts = mockCreateContainer.mock.calls[0][0];
      expect(createOpts.Image).toBe('custom-image:v2');
    });

    it('should fall back to config.docker.baseImage when agent.docker_image is null', async () => {
      const cfg = makeContainerConfig({
        agent: makeAgent({ docker_image: null }),
      });
      await createAgentContainer(cfg);

      const createOpts = mockCreateContainer.mock.calls[0][0];
      expect(createOpts.Image).toBe('tinyhands-runner:latest');
    });

    it('should include standard env vars (API key, agent ID, trace ID)', async () => {
      const cfg = makeContainerConfig();
      await createAgentContainer(cfg);

      const envList: string[] = mockCreateContainer.mock.calls[0][0].Env;
      expect(envList).toContain('ANTHROPIC_API_KEY=test-key');
      expect(envList).toContain('AGENT_ID=agent-1');
      expect(envList).toContain('AGENT_NAME=test-agent');
      expect(envList).toContain('TRACE_ID=trace-123');
    });

    it('should include custom envVars from config', async () => {
      const cfg = makeContainerConfig({
        envVars: {
          SYSTEM_PROMPT: 'Custom prompt',
          TASK_PROMPT: 'Do X',
          MODEL: 'claude-sonnet-4-20250514',
          MAX_TURNS: '5',
          EXTRA_VAR: 'extra-value',
        },
      });
      await createAgentContainer(cfg);

      const envList: string[] = mockCreateContainer.mock.calls[0][0].Env;
      expect(envList).toContain('SYSTEM_PROMPT=Custom prompt');
      expect(envList).toContain('TASK_PROMPT=Do X');
      expect(envList).toContain('MAX_TURNS=5');
      expect(envList).toContain('EXTRA_VAR=extra-value');
    });

    it('should set WorkingDir to /workspace', async () => {
      await createAgentContainer(makeContainerConfig());

      const createOpts = mockCreateContainer.mock.calls[0][0];
      expect(createOpts.WorkingDir).toBe('/workspace');
    });

    it('should bind-mount workspace, sources, and memory directories', async () => {
      const cfg = makeContainerConfig();
      await createAgentContainer(cfg);

      const binds: string[] = mockCreateContainer.mock.calls[0][0].HostConfig.Binds;
      expect(binds).toContain('/tmp/tinyhands-workspaces/agent-1:/workspace:rw');
      expect(binds).toContain('/tmp/tinyhands-sources-cache/agent-1:/sources:ro');
      expect(binds).toContain('/tmp/tinyhands-memory/agent-1:/memory:ro');
    });

    it('should apply standard security config', async () => {
      await createAgentContainer(makeContainerConfig());

      const hostConfig = mockCreateContainer.mock.calls[0][0].HostConfig;
      expect(hostConfig.Memory).toBe(4 * 1024 * 1024 * 1024);
      expect(hostConfig.NanoCpus).toBe(1e9);
      expect(hostConfig.NetworkMode).toBe('bridge');
      expect(hostConfig.SecurityOpt).toEqual(['no-new-privileges:true']);
      expect(hostConfig.CapDrop).toEqual(['ALL']);
    });

    it('should set labels for agent_id and trace_id', async () => {
      const cfg = makeContainerConfig({
        agent: makeAgent({ id: 'agent-42' }),
        traceId: 'trace-xyz',
      });
      await createAgentContainer(cfg);

      const labels = mockCreateContainer.mock.calls[0][0].Labels;
      expect(labels['tinyhands.agent_id']).toBe('agent-42');
      expect(labels['tinyhands.trace_id']).toBe('trace-xyz');
    });

    it('should set AutoRemove to false', async () => {
      await createAgentContainer(makeContainerConfig());

      const hostConfig = mockCreateContainer.mock.calls[0][0].HostConfig;
      expect(hostConfig.AutoRemove).toBe(false);
    });

    it('should create required directories', async () => {
      const cfg = makeContainerConfig();
      await createAgentContainer(cfg);

      expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/tinyhands-workspaces/agent-1', { recursive: true });
      expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/tinyhands-sources-cache/agent-1', { recursive: true });
      expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/tinyhands-memory/agent-1', { recursive: true });
    });

    it('should attempt chown on workspace dir and fall back to chmod on failure', async () => {
      (fs.chownSync as any).mockImplementationOnce(() => {
        throw new Error('EPERM');
      });

      await createAgentContainer(makeContainerConfig());

      expect(fs.chownSync).toHaveBeenCalledWith('/tmp/tinyhands-workspaces/agent-1', 999, 999);
      expect(fs.chmodSync).toHaveBeenCalledWith('/tmp/tinyhands-workspaces/agent-1', 0o777);
    });

    it('should return the created container', async () => {
      const container = await createAgentContainer(makeContainerConfig());

      expect(container.id).toBe('container-123');
    });

    it('should propagate Docker API errors', async () => {
      mockCreateContainer.mockRejectedValueOnce(new Error('image not found'));

      await expect(createAgentContainer(makeContainerConfig())).rejects.toThrow('image not found');
    });

  });

  // ────────────────────────────────────────────
  // startContainer
  // ────────────────────────────────────────────

  describe('startContainer', () => {
    it('should call container.start()', async () => {
      const container = { start: vi.fn() } as any;
      await startContainer(container);

      expect(container.start).toHaveBeenCalledTimes(1);
    });

    it('should propagate errors from container.start()', async () => {
      const container = {
        start: vi.fn().mockRejectedValueOnce(new Error('container already started')),
      } as any;

      await expect(startContainer(container)).rejects.toThrow('container already started');
    });
  });

  // ────────────────────────────────────────────
  // waitForContainer
  // ────────────────────────────────────────────

  describe('waitForContainer', () => {
    it('should resolve with exitCode 0 on success', async () => {
      const container = {
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        kill: vi.fn(),
      } as any;

      const result = await waitForContainer(container, 10000);

      expect(result).toEqual({ exitCode: 0 });
    });

    it('should resolve with non-zero exit code', async () => {
      const container = {
        wait: vi.fn().mockResolvedValue({ StatusCode: 137 }),
        kill: vi.fn(),
      } as any;

      const result = await waitForContainer(container, 10000);

      expect(result).toEqual({ exitCode: 137 });
    });

    it('should reject on timeout and kill container', async () => {
      vi.useFakeTimers();

      const container = {
        wait: vi.fn().mockReturnValue(new Promise(() => {})), // never resolves
        kill: vi.fn().mockResolvedValue(undefined),
      } as any;

      const promise = waitForContainer(container, 5000);

      vi.advanceTimersByTime(5000);

      await expect(promise).rejects.toThrow('Container timed out after 5000ms');
      expect(container.kill).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should reject if container.wait() rejects', async () => {
      const container = {
        wait: vi.fn().mockRejectedValue(new Error('container gone')),
        kill: vi.fn(),
      } as any;

      await expect(waitForContainer(container, 10000)).rejects.toThrow('container gone');
    });

    it('should clear timeout on successful wait', async () => {
      vi.useFakeTimers();

      const container = {
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        kill: vi.fn(),
      } as any;

      const result = await waitForContainer(container, 30000);
      expect(result.exitCode).toBe(0);

      // Advance timers past timeout — kill should NOT be called
      vi.advanceTimersByTime(35000);
      expect(container.kill).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  // ────────────────────────────────────────────
  // removeContainer
  // ────────────────────────────────────────────

  describe('removeContainer', () => {
    it('should call container.remove with force: true', async () => {
      const container = { remove: vi.fn().mockResolvedValue(undefined) } as any;
      await removeContainer(container);

      expect(container.remove).toHaveBeenCalledWith({ force: true });
    });

    it('should silently ignore 404 errors (already removed)', async () => {
      const err = new Error('container not found') as any;
      err.statusCode = 404;
      const container = { remove: vi.fn().mockRejectedValue(err) } as any;

      // Should not throw
      await expect(removeContainer(container)).resolves.toBeUndefined();
    });

    it('should rethrow non-404 errors', async () => {
      const err = new Error('permission denied') as any;
      err.statusCode = 403;
      const container = { remove: vi.fn().mockRejectedValue(err) } as any;

      await expect(removeContainer(container)).rejects.toThrow('permission denied');
    });

    it('should rethrow errors without statusCode', async () => {
      const container = {
        remove: vi.fn().mockRejectedValue(new Error('unknown error')),
      } as any;

      await expect(removeContainer(container)).rejects.toThrow('unknown error');
    });
  });

  // ────────────────────────────────────────────
  // getContainerLogs
  // ────────────────────────────────────────────

  describe('getContainerLogs', () => {
    it('should call container.logs with stdout and stderr', async () => {
      // Return a simple buffer with no Docker framing (TTY mode fallback)
      const plainLog = Buffer.from('hello from container');
      const container = {
        logs: vi.fn().mockResolvedValue(plainLog),
      } as any;

      const result = await getContainerLogs(container);

      expect(container.logs).toHaveBeenCalledWith({
        stdout: true,
        stderr: true,
        follow: false,
      });
      expect(result).toBe('hello from container');
    });

    it('should demultiplex Docker stream frames', async () => {
      // Build a properly framed Docker log buffer
      // Frame format: [stream_type(1), 0x00, 0x00, 0x00, size(4 BE)] + payload
      const payload1 = Buffer.from('line one\n');
      const payload2 = Buffer.from('line two\n');

      const frame1Header = Buffer.alloc(8);
      frame1Header.writeUInt8(1, 0); // stdout
      frame1Header.writeUInt32BE(payload1.length, 4);

      const frame2Header = Buffer.alloc(8);
      frame2Header.writeUInt8(1, 0); // stdout
      frame2Header.writeUInt32BE(payload2.length, 4);

      const buf = Buffer.concat([frame1Header, payload1, frame2Header, payload2]);
      const container = { logs: vi.fn().mockResolvedValue(buf) } as any;

      const result = await getContainerLogs(container);

      expect(result).toBe('line one\nline two\n');
    });

    it('should strip null bytes from output', async () => {
      const buf = Buffer.from('hello\0world');
      const container = { logs: vi.fn().mockResolvedValue(buf) } as any;

      const result = await getContainerLogs(container);

      expect(result).toBe('helloworld');
      expect(result).not.toContain('\0');
    });

    it('should handle string response by converting to buffer', async () => {
      // container.logs may return a string in some cases
      const container = { logs: vi.fn().mockResolvedValue('log output') } as any;

      const result = await getContainerLogs(container);

      expect(result).toBe('log output');
    });

    it('should handle empty logs', async () => {
      const container = { logs: vi.fn().mockResolvedValue(Buffer.alloc(0)) } as any;

      const result = await getContainerLogs(container);

      expect(result).toBe('');
    });

    it('should handle truncated frame where offset + size > buf.length', async () => {
      // Build a frame header claiming 100 bytes but only provide 5 bytes of payload
      const header = Buffer.alloc(8);
      header.writeUInt8(1, 0); // stdout
      header.writeUInt32BE(100, 4); // claims 100 bytes
      const shortPayload = Buffer.from('hello');
      const buf = Buffer.concat([header, shortPayload]);
      const container = { logs: vi.fn().mockResolvedValue(buf) } as any;

      const result = await getContainerLogs(container);
      // Should fall back to non-multiplexed mode since chunks array is empty
      expect(result).toContain('hello');
    });

    it('should strip null bytes from demultiplexed output', async () => {
      const payload = Buffer.from('hello\0world');
      const header = Buffer.alloc(8);
      header.writeUInt8(1, 0);
      header.writeUInt32BE(payload.length, 4);
      const buf = Buffer.concat([header, payload]);
      const container = { logs: vi.fn().mockResolvedValue(buf) } as any;

      const result = await getContainerLogs(container);
      expect(result).toBe('helloworld');
    });
  });

  // ────────────────────────────────────────────
  // waitForContainer — timeout kill error path
  // ────────────────────────────────────────────

  describe('waitForContainer - timeout kill error', () => {
    it('should reject with kill error when container.kill() fails during timeout', async () => {
      vi.useFakeTimers();

      const killError = new Error('kill failed');
      const container = {
        wait: vi.fn().mockReturnValue(new Promise(() => {})), // never resolves
        kill: vi.fn().mockRejectedValue(killError),
      } as any;

      const promise = waitForContainer(container, 5000);

      vi.advanceTimersByTime(5000);

      await expect(promise).rejects.toThrow('kill failed');

      vi.useRealTimers();
    });
  });

  // ────────────────────────────────────────────
  // followContainerOutput
  // ────────────────────────────────────────────

  describe('followContainerOutput', () => {
    it('should attach, start, and stream stdout lines via onLine callback', async () => {
      const { PassThrough } = await import('stream');
      const stdoutPassThrough = new PassThrough();
      const stderrPassThrough = new PassThrough();

      const mockStream = new PassThrough();

      const container = {
        attach: vi.fn().mockResolvedValue(mockStream),
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        kill: vi.fn(),
      } as any;

      // Mock demuxStream to pipe data to stdout/stderr passthrough streams
      mockDemuxStream.mockImplementation((_stream: any, stdout: any, _stderr: any) => {
        // Simulate sending data to stdout
        setTimeout(() => {
          stdout.write(Buffer.from('{"event":"start"}\n{"event":"end"}\n'));
        }, 1);
      });

      const lines: string[] = [];
      const onLine = (line: string) => lines.push(line);

      const result = await followContainerOutput(container, onLine, 30000);

      expect(container.attach).toHaveBeenCalledWith({
        stream: true,
        stdout: true,
        stderr: true,
      });
      expect(container.start).toHaveBeenCalled();
      expect(result.exitCode).toBe(0);
      expect(result.allLogs).toContain('{"event":"start"}');
    });

    it('should collect stderr lines prefixed with [stderr]', async () => {
      const { PassThrough } = await import('stream');
      const mockStream = new PassThrough();

      const container = {
        attach: vi.fn().mockResolvedValue(mockStream),
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        kill: vi.fn(),
      } as any;

      mockDemuxStream.mockImplementation((_stream: any, _stdout: any, stderr: any) => {
        setTimeout(() => {
          stderr.write(Buffer.from('error message'));
        }, 1);
      });

      const lines: string[] = [];
      const result = await followContainerOutput(container, (line) => lines.push(line), 30000);

      expect(result.exitCode).toBe(0);
      expect(result.allLogs).toContain('[stderr] error message');
    });

    it('should flush remaining lineBuffer after container exits', async () => {
      const { PassThrough } = await import('stream');
      const mockStream = new PassThrough();

      const container = {
        attach: vi.fn().mockResolvedValue(mockStream),
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        kill: vi.fn(),
      } as any;

      mockDemuxStream.mockImplementation((_stream: any, stdout: any, _stderr: any) => {
        // Send data without trailing newline to test flush
        setTimeout(() => {
          stdout.write(Buffer.from('partial-line'));
        }, 1);
      });

      const lines: string[] = [];
      const result = await followContainerOutput(container, (line) => lines.push(line), 30000);

      expect(result.allLogs).toContain('partial-line');
      expect(lines).toContain('partial-line');
    });

    it('should ignore errors thrown by onLine callback', async () => {
      const { PassThrough } = await import('stream');
      const mockStream = new PassThrough();

      const container = {
        attach: vi.fn().mockResolvedValue(mockStream),
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        kill: vi.fn(),
      } as any;

      mockDemuxStream.mockImplementation((_stream: any, stdout: any, _stderr: any) => {
        setTimeout(() => {
          stdout.write(Buffer.from('line1\nline2\n'));
        }, 1);
      });

      const onLine = vi.fn().mockImplementation(() => {
        throw new Error('callback error');
      });

      // Should not throw even though callback throws
      const result = await followContainerOutput(container, onLine, 30000);
      expect(result.exitCode).toBe(0);
    });

    it('should return non-zero exit code', async () => {
      const { PassThrough } = await import('stream');
      const mockStream = new PassThrough();

      const container = {
        attach: vi.fn().mockResolvedValue(mockStream),
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 1 }),
        kill: vi.fn(),
      } as any;

      mockDemuxStream.mockImplementation(() => {});

      const result = await followContainerOutput(container, vi.fn(), 30000);
      expect(result.exitCode).toBe(1);
    });

    it('should skip empty lines from stdout', async () => {
      const { PassThrough } = await import('stream');
      const mockStream = new PassThrough();

      const container = {
        attach: vi.fn().mockResolvedValue(mockStream),
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        kill: vi.fn(),
      } as any;

      mockDemuxStream.mockImplementation((_stream: any, stdout: any, _stderr: any) => {
        setTimeout(() => {
          stdout.write(Buffer.from('line1\n\n\nline2\n'));
        }, 1);
      });

      const lines: string[] = [];
      const result = await followContainerOutput(container, (line) => lines.push(line), 30000);

      // Empty lines should be skipped (trimmed empty lines are falsy)
      expect(lines).toContain('line1');
      expect(lines).toContain('line2');
      expect(lines).not.toContain('');
    });

    it('should ignore errors from onLine during buffer flush', async () => {
      const { PassThrough } = await import('stream');
      const mockStream = new PassThrough();

      const container = {
        attach: vi.fn().mockResolvedValue(mockStream),
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        kill: vi.fn(),
      } as any;

      // Send data without trailing newline so it only flushes after exit
      mockDemuxStream.mockImplementation((_stream: any, stdout: any, _stderr: any) => {
        setTimeout(() => {
          stdout.write(Buffer.from('flush-data'));
        }, 1);
      });

      const onLine = vi.fn().mockImplementation(() => {
        throw new Error('flush callback error');
      });

      const result = await followContainerOutput(container, onLine, 30000);
      expect(result.exitCode).toBe(0);
      expect(result.allLogs).toContain('flush-data');
    });

    it('should skip empty stderr', async () => {
      const { PassThrough } = await import('stream');
      const mockStream = new PassThrough();

      const container = {
        attach: vi.fn().mockResolvedValue(mockStream),
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        kill: vi.fn(),
      } as any;

      mockDemuxStream.mockImplementation((_stream: any, _stdout: any, stderr: any) => {
        setTimeout(() => {
          stderr.write(Buffer.from('   '));
        }, 1);
      });

      const result = await followContainerOutput(container, vi.fn(), 30000);
      // Empty trimmed stderr should not be added to logs
      expect(result.allLogs).not.toContain('[stderr]');
    });
  });

  // ────────────────────────────────────────────
  // buildBaseImage
  // ────────────────────────────────────────────

  describe('buildBaseImage', () => {
    it('should build the Docker image with correct context and tag', async () => {
      const mockStream = {};
      mockBuildImage.mockResolvedValue(mockStream);
      mockFollowProgress.mockImplementation((_stream: any, cb: (err: Error | null) => void) => {
        cb(null);
      });

      await buildBaseImage();

      expect(mockBuildImage).toHaveBeenCalledWith(
        { context: './docker', src: ['Dockerfile'] },
        { t: 'tinyhands-runner:latest' }
      );
    });

    it('should reject when build fails', async () => {
      const mockStream = {};
      mockBuildImage.mockResolvedValue(mockStream);
      mockFollowProgress.mockImplementation((_stream: any, cb: (err: Error | null) => void) => {
        cb(new Error('build failed'));
      });

      await expect(buildBaseImage()).rejects.toThrow('build failed');
    });
  });

  // ────────────────────────────────────────────
  // listAgentContainers
  // ────────────────────────────────────────────

  describe('listAgentContainers', () => {
    it('should list containers with tinyhands label filter', async () => {
      const mockContainers = [
        { Id: 'c1', Labels: { 'tinyhands.agent_id': 'agent-1' } },
        { Id: 'c2', Labels: { 'tinyhands.agent_id': 'agent-2' } },
      ];
      mockListContainers.mockResolvedValue(mockContainers);

      const result = await listAgentContainers();

      expect(result).toEqual(mockContainers);
      expect(mockListContainers).toHaveBeenCalledWith({
        all: true,
        filters: { label: ['tinyhands.agent_id'] },
      });
    });

    it('should return empty array when no agent containers exist', async () => {
      mockListContainers.mockResolvedValue([]);

      const result = await listAgentContainers();

      expect(result).toEqual([]);
    });
  });
});
