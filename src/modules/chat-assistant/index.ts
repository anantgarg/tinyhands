import Anthropic from '@anthropic-ai/sdk';
import { getAgent, listAgents } from '../agents';
import { getAgentErrorRates } from '../observability';
import { canModifyAgent } from '../access-control';
import { buildSystemPrompt, buildAgentContext } from './prompts';
import { DIAGNOSTIC_TOOLS, TOOL_CALL_LABELS, executeToolCall } from './tools';
import { logger } from '../../utils/logger';
import type { ModelAlias } from '../../types';

// ── Types ──

export interface ChatStreamEvent {
  type: 'text' | 'tool_call' | 'proposed_changes' | 'done' | 'error';
  content?: string;
  name?: string;
  label?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
  canApply?: boolean;
  toolCallsUsed?: string[];
}

export interface ChatRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  agentId?: string;
  context: string; // 'dashboard' | 'agent' | 'tools' | 'kb' | 'general'
  modelOverride?: ModelAlias;
  workspaceId: string;
  userId: string;
}

// ── Model mapping ──

function getModelId(model: ModelAlias): string {
  switch (model) {
    case 'opus': return 'claude-opus-4-20250514';
    case 'haiku': return 'claude-haiku-4-5-20251001';
    default: return 'claude-sonnet-4-20250514';
  }
}

// ── Max tool calls per turn ──
const MAX_TOOL_CALLS = 8;

// ── Core streaming function ──

export async function streamChat(
  request: ChatRequest,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const { messages, agentId, context, modelOverride, workspaceId, userId } = request;
  const model = modelOverride || 'sonnet';

  try {
    // Build context for system prompt
    const agents = await listAgents(workspaceId);
    const agentNames = agents.map(a => a.name);

    let selectedAgentCtx;
    if (agentId) {
      const agent = await getAgent(workspaceId, agentId);
      if (agent) {
        // Get error rate for this agent
        const errorRates = await getAgentErrorRates(workspaceId);
        const agentRate = errorRates.find(r => r.agentId === agentId);
        selectedAgentCtx = buildAgentContext(agent, agentRate?.errorRate);
      }
    }

    const systemPrompt = buildSystemPrompt({
      workspaceAgentCount: agents.length,
      workspaceAgentNames: agentNames,
      currentPage: context,
      selectedAgent: selectedAgentCtx,
    });

    // Build messages for Anthropic API
    const apiMessages: Anthropic.MessageParam[] = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const client = new Anthropic();
    const toolCallsUsed: string[] = [];
    let toolCallCount = 0;

    // Tool-use loop: keep calling until Claude stops requesting tools
    const currentMessages = [...apiMessages];

    while (true) {
      const response = await client.messages.create({
        model: getModelId(model),
        max_tokens: 4096,
        system: systemPrompt,
        messages: currentMessages,
        tools: DIAGNOSTIC_TOOLS,
        stream: true,
      });

      let fullText = '';
      const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
      let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
      let stopReason: string | null = null;

      for await (const event of response) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'text') {
            // Text block starting
          } else if (event.content_block.type === 'tool_use') {
            currentToolUse = {
              id: event.content_block.id,
              name: event.content_block.name,
              inputJson: '',
            };
            // Notify frontend about tool call
            const label = TOOL_CALL_LABELS[event.content_block.name] || `Using ${event.content_block.name}...`;
            onEvent({ type: 'tool_call', name: event.content_block.name, label });
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            fullText += event.delta.text;
            onEvent({ type: 'text', content: event.delta.text });
          } else if (event.delta.type === 'input_json_delta' && currentToolUse) {
            currentToolUse.inputJson += event.delta.partial_json;
          }
        } else if (event.type === 'content_block_stop') {
          if (currentToolUse) {
            let parsedInput: Record<string, unknown> = {};
            try {
              parsedInput = JSON.parse(currentToolUse.inputJson || '{}');
            } catch {
              // Empty or malformed input
            }
            toolUseBlocks.push({
              id: currentToolUse.id,
              name: currentToolUse.name,
              input: parsedInput,
            });
            currentToolUse = null;
          }
        } else if (event.type === 'message_delta') {
          stopReason = event.delta.stop_reason;
        }
      }

      // If Claude wants to use tools, execute them and continue
      if (stopReason === 'tool_use' && toolUseBlocks.length > 0 && toolCallCount < MAX_TOOL_CALLS) {
        // Build the assistant message with all content blocks
        const assistantContent: Anthropic.ContentBlockParam[] = [];
        if (fullText) {
          assistantContent.push({ type: 'text', text: fullText });
        }
        for (const tu of toolUseBlocks) {
          assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
        }

        currentMessages.push({ role: 'assistant', content: assistantContent });

        // Execute each tool and build tool_result messages
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const tu of toolUseBlocks) {
          toolCallCount++;
          const friendlyName = TOOL_CALL_LABELS[tu.name]?.replace('...', '') || tu.name;
          if (!toolCallsUsed.includes(friendlyName)) toolCallsUsed.push(friendlyName);

          const result = await executeToolCall(tu.name, tu.input, workspaceId);

          // Check if this is a propose_agent_changes result with actual changes
          if (tu.name === 'propose_agent_changes' && !result.is_error) {
            try {
              const parsed = JSON.parse(result.content);
              if (parsed.proposedChanges) {
                const canApply = agentId ? await canModifyAgent(workspaceId, agentId, userId) : false;
                onEvent({
                  type: 'proposed_changes',
                  changes: parsed.proposedChanges,
                  canApply,
                });
              }
            } catch {
              // Not valid JSON, continue normally
            }
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: result.content,
            is_error: result.is_error,
          });
        }

        currentMessages.push({ role: 'user', content: toolResults });

        // Continue the loop to get Claude's next response
        continue;
      }

      // Claude is done (end_turn or max tool calls reached)
      break;
    }

    onEvent({ type: 'done', toolCallsUsed });
  } catch (err: any) {
    logger.error('Chat assistant error', { error: err.message, agentId });
    onEvent({ type: 'error', content: err.message || 'Something went wrong. Please try again.' });
  }
}

// ── Non-streaming wrapper ──

export async function chatSync(request: ChatRequest): Promise<{
  response: string;
  proposedChanges?: Record<string, { from: unknown; to: unknown }>;
  canApply?: boolean;
  toolCallsUsed?: string[];
}> {
  let fullResponse = '';
  let proposedChanges: Record<string, { from: unknown; to: unknown }> | undefined;
  let canApply: boolean | undefined;
  let toolCallsUsed: string[] | undefined;

  await streamChat(request, (event) => {
    switch (event.type) {
      case 'text':
        fullResponse += event.content || '';
        break;
      case 'proposed_changes':
        proposedChanges = event.changes;
        canApply = event.canApply;
        break;
      case 'done':
        toolCallsUsed = event.toolCallsUsed;
        break;
      case 'error':
        fullResponse = event.content || 'Something went wrong. Please try again.';
        break;
    }
  });

  return { response: fullResponse, proposedChanges, canApply, toolCallsUsed };
}
