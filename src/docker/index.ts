import Dockerode from 'dockerode';
import fs from 'fs';
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
      SecurityOpt: securityConfig.noNewPrivileges ? ['no-new-privileges:true'] : [],
      CapDrop: securityConfig.dropCapabilities,
      AutoRemove: true,
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
