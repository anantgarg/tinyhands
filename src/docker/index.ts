import Dockerode from 'dockerode';
import fs from 'fs';
import { PassThrough } from 'stream';
import { config } from '../config';
import { getDockerSecurityConfig } from '../modules/permissions';
import type { Agent } from '../types';
import { logger } from '../utils/logger';

const docker = new Dockerode();

export interface ContainerConfig {
  agent: Agent;
  traceId: string;
  workingDir: string;
  envVars: Record<string, string>;
  networkAllowlist?: string[];
}

export interface ContainerResult {
  containerId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function createAgentContainer(cfg: ContainerConfig): Promise<Dockerode.Container> {
  const image = cfg.agent.docker_image || config.docker.baseImage;

  const envList = [
    `ANTHROPIC_API_KEY=${config.anthropic.apiKey}`,
    `AGENT_ID=${cfg.agent.id}`,
    `AGENT_NAME=${cfg.agent.name}`,
    `TRACE_ID=${cfg.traceId}`,
    ...Object.entries(cfg.envVars).map(([k, v]) => `${k}=${v}`),
  ];

  // Ensure directories exist
  const sourcesCacheDir = `/tmp/tinyjobs-sources-cache/${cfg.agent.id}`;
  const memoryDir = `/tmp/tinyjobs-memory/${cfg.agent.id}`;
  for (const dir of [cfg.workingDir, sourcesCacheDir, memoryDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Ensure the workspace dir is writable by the container's agent user (uid 999)
  try {
    fs.chownSync(cfg.workingDir, 999, 999);
  } catch {
    // Fallback: make world-writable if chown fails
    fs.chmodSync(cfg.workingDir, 0o777);
  }

  // Apply security config based on permission level
  const securityConfig = getDockerSecurityConfig(cfg.agent.permission_level);

  const container = await docker.createContainer({
    Image: image,
    Env: envList,
    WorkingDir: '/workspace',
    HostConfig: {
      Binds: [
        `${cfg.workingDir}:/workspace:rw`,
        `${sourcesCacheDir}:/sources:ro`,
        `${memoryDir}:/memory:ro`,
      ],
      Memory: securityConfig.memoryLimit,
      NanoCpus: securityConfig.cpuLimit * 1e9,
      NetworkMode: securityConfig.networkMode,
      ReadonlyRootfs: securityConfig.readOnlyRootfs,
      Tmpfs: securityConfig.readOnlyRootfs ? { '/tmp': 'rw,nosuid,size=1024m', '/home/agent': 'rw,nosuid,size=128m,uid=999,gid=999' } : undefined,
      SecurityOpt: securityConfig.noNewPrivileges ? ['no-new-privileges:true'] : [],
      CapDrop: securityConfig.dropCapabilities,
      AutoRemove: false,
    },
    Labels: {
      'tinyjobs.agent_id': cfg.agent.id,
      'tinyjobs.trace_id': cfg.traceId,
      'tinyjobs.permission_level': cfg.agent.permission_level,
    },
  });

  logger.info('Container created', {
    containerId: container.id,
    agentId: cfg.agent.id,
    traceId: cfg.traceId,
    image,
  });

  return container;
}

export async function startContainer(container: Dockerode.Container): Promise<void> {
  await container.start();
}

export async function waitForContainer(
  container: Dockerode.Container,
  timeoutMs: number
): Promise<{ exitCode: number }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(async () => {
      try {
        await container.kill();
        reject(new Error(`Container timed out after ${timeoutMs}ms`));
      } catch (err) {
        reject(err);
      }
    }, timeoutMs);

    container.wait()
      .then((result: { StatusCode: number }) => {
        clearTimeout(timer);
        resolve({ exitCode: result.StatusCode });
      })
      .catch((err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export async function getContainerLogs(container: Dockerode.Container): Promise<string> {
  const logs = await container.logs({
    stdout: true,
    stderr: true,
    follow: false,
  });
  const buf = Buffer.isBuffer(logs) ? logs : Buffer.from(logs);
  // Demultiplex Docker stream: each frame has an 8-byte header
  // [stream_type(1), 0x00, 0x00, 0x00, size(4 BE)] followed by payload
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + size > buf.length) break;
    chunks.push(buf.subarray(offset, offset + size));
    offset += size;
  }
  if (chunks.length === 0) {
    // Fallback: not multiplexed (e.g. TTY mode), strip null bytes
    return buf.toString('utf8').replace(/\0/g, '');
  }
  return Buffer.concat(chunks).toString('utf8').replace(/\0/g, '');
}

export type StreamEventCallback = (line: string) => void;

/**
 * Attach to container stdout BEFORE starting it, then start and stream
 * JSONL events in real-time. Calls onLine for each line of output.
 * Returns exit code and all collected log lines.
 */
export async function followContainerOutput(
  container: Dockerode.Container,
  onLine: StreamEventCallback,
  timeoutMs: number,
): Promise<{ exitCode: number; allLogs: string }> {
  const allLogLines: string[] = [];

  // Attach BEFORE starting — this is critical for real-time streaming.
  // container.logs({ follow: true }) buffers until exit; attach() streams immediately.
  const stream = await container.attach({
    stream: true,
    stdout: true,
    stderr: true,
  });

  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();

  // Demux Docker multiplexed stream (8-byte header per frame)
  (docker as any).modem.demuxStream(stream, stdoutStream, stderrStream);

  let lineBuffer = '';
  stdoutStream.on('data', (chunk: Buffer) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        allLogLines.push(trimmed);
        try { onLine(trimmed); } catch (e) { /* ignore callback errors */ }
      }
    }
  });

  stderrStream.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) allLogLines.push(`[stderr] ${text}`);
  });

  // Start the container AFTER attaching so we don't miss any output
  await container.start();

  // Wait for container to exit
  const { exitCode } = await waitForContainer(container, timeoutMs);

  // Small delay to let remaining buffered data flush through streams
  await new Promise(r => setTimeout(r, 500));

  // Flush remaining buffer
  if (lineBuffer.trim()) {
    allLogLines.push(lineBuffer.trim());
    try { onLine(lineBuffer.trim()); } catch {}
  }

  stdoutStream.destroy();
  stderrStream.destroy();

  return { exitCode, allLogs: allLogLines.join('\n') };
}

export async function removeContainer(container: Dockerode.Container): Promise<void> {
  try {
    await container.remove({ force: true });
  } catch (err: any) {
    if (err.statusCode !== 404) throw err; // already removed (AutoRemove)
  }
}

export async function buildBaseImage(): Promise<void> {
  logger.info('Building base Docker image', { image: config.docker.baseImage });

  const stream = await docker.buildImage(
    { context: './docker', src: ['Dockerfile'] },
    { t: config.docker.baseImage }
  );

  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });

  logger.info('Base image built', { image: config.docker.baseImage });
}

export async function listAgentContainers(): Promise<Dockerode.ContainerInfo[]> {
  return docker.listContainers({
    all: true,
    filters: { label: ['tinyjobs.agent_id'] },
  });
}
