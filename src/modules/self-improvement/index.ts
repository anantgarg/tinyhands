import { v4 as uuid } from 'uuid';
import { getAgent, updateAgent, getAgentVersions, revertAgent } from '../agents';
import { logger } from '../../utils/logger';

export interface PromptDiff {
  original: string;
  proposed: string;
  changeNote: string;
}

export function detectCritique(message: string): boolean {
  const critiquePatterns = [
    /why did you/i,
    /that'?s wrong/i,
    /fix your/i,
    /don'?t do that/i,
    /you should/i,
    /instead of/i,
    /that was incorrect/i,
    /please change/i,
    /improve your/i,
    /stop doing/i,
    /next time/i,
    /you need to/i,
  ];

  return critiquePatterns.some(p => p.test(message));
}

export async function generatePromptDiff(
  workspaceId: string,
  currentPrompt: string,
  critique: string,
  runOutput: string
): Promise<PromptDiff> {
  const changeNote = `Self-improvement based on critique: "${critique.slice(0, 100)}"`;

  // Call Claude to analyze the critique and propose prompt changes
  try {
    const { createAnthropicClient } = await import('../anthropic');
    const client = await createAnthropicClient(workspaceId);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: `You are a prompt engineer. Given a system prompt and user critique, produce an improved version of the prompt.
Return the COMPLETE improved prompt — every section must be included, even those you did not change. Do not truncate, summarize, or omit any part of the original prompt. Only modify the parts relevant to the critique.
Return ONLY the improved prompt text — no explanation, no markdown fences.`,
      messages: [{
        role: 'user',
        content: `## Current System Prompt
${currentPrompt}

## User Critique
${critique}

## Recent Agent Output (for context)
${runOutput.slice(0, 1000)}

Produce an improved system prompt that addresses the critique while preserving the original intent.`,
      }],
    });

    const proposed = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    return {
      original: currentPrompt,
      proposed: proposed || currentPrompt,
      changeNote,
    };
  } catch (err: any) {
    logger.warn('AI prompt diff generation failed, returning unchanged', { error: err.message });
    return {
      original: currentPrompt,
      proposed: currentPrompt,
      changeNote: `${changeNote} (AI generation failed: ${err.message})`,
    };
  }
}

export async function applyPromptDiff(
  workspaceId: string,
  agentId: string,
  newPrompt: string,
  changeNote: string,
  changedBy: string
): Promise<{ agent: Awaited<ReturnType<typeof getAgent>>; version: number }> {
  const agent = await updateAgent(workspaceId, agentId, { system_prompt: newPrompt }, changedBy);

  const versions = await getAgentVersions(workspaceId, agentId);
  const latestVersion = versions[0]?.version || 1;

  logger.info('Self-improvement applied', {
    agentId,
    version: latestVersion,
    changeNote,
  });

  return { agent, version: latestVersion };
}

export async function revertToVersion(
  workspaceId: string,
  agentId: string,
  version: number,
  changedBy: string
): Promise<Awaited<ReturnType<typeof getAgent>>> {
  const agent = await revertAgent(workspaceId, agentId, version, changedBy);

  logger.info('Agent reverted', { agentId, version, changedBy });
  return agent;
}

export async function checkPromptSize(workspaceId: string, agentId: string): Promise<{ tokenCount: number; warning: boolean }> {
  const agent = await getAgent(workspaceId, agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const tokenCount = Math.ceil(agent.system_prompt.length / 4);
  const WARNING_THRESHOLD = 4000;

  return {
    tokenCount,
    warning: tokenCount > WARNING_THRESHOLD,
  };
}

export function formatDiffForSlack(original: string, proposed: string): string {
  const originalLines = original.split('\n');
  const proposedLines = proposed.split('\n');

  const blocks: string[] = [];

  // Simple line-by-line diff
  const maxLines = Math.max(originalLines.length, proposedLines.length);
  for (let i = 0; i < maxLines; i++) {
    const origLine = originalLines[i] || '';
    const propLine = proposedLines[i] || '';

    if (origLine !== propLine) {
      if (origLine) blocks.push(`- ${origLine}`);
      if (propLine) blocks.push(`+ ${propLine}`);
    }
  }

  if (blocks.length === 0) return '_No changes detected_';

  return '```diff\n' + blocks.join('\n') + '\n```';
}
