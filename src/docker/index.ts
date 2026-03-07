import Dockerode from 'dockerode';
import { config } from '../config';
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

  const container = await docker.createContainer({
    Image: image,
    Env: envList,
    WorkingDir: '/workspace',
    HostConfig: {
      Binds: [
        `${cfg.workingDir}:/workspace:rw`,
      ],
      Memory: config.docker.defaultMemory,
      NanoCpus: config.docker.defaultCpu * 1e9,
      NetworkMode: cfg.networkAllowlist?.length ? 'bridge' : 'none',
      AutoRemove: true,
    },
    Labels: {
      'tinyjobs.agent_id': cfg.agent.id,
      'tinyjobs.trace_id': cfg.traceId,
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
  return logs.toString('utf8');
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
