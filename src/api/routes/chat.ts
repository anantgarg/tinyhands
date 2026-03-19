import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { getAgent, listAgents } from '../../modules/agents';
import { analyzeGoal } from '../../modules/agents/goal-analyzer';
import { canModifyAgent } from '../../modules/access-control';
import { logger } from '../../utils/logger';

const router = Router();

// POST /chat — AI chat endpoint
router.post('/', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { message, agentId, context } = req.body;

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    // If an agentId is provided, try to handle as an agent update request
    if (agentId) {
      const agent = await getAgent(workspaceId, agentId);
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      const canModify = await canModifyAgent(workspaceId, agentId, userId);

      // Use the goal analyzer to interpret the message as an agent update
      try {
        const analysis = await analyzeGoal(
          workspaceId,
          message,
          agent.system_prompt,
          userId,
          agent.name,
        );

        // Build proposed changes by comparing current agent to analysis
        const proposedChanges: Record<string, { from: unknown; to: unknown }> = {};

        if (analysis.agent_name !== agent.name) {
          proposedChanges.name = { from: agent.name, to: analysis.agent_name };
        }
        if (analysis.system_prompt !== agent.system_prompt) {
          proposedChanges.systemPrompt = { from: agent.system_prompt, to: analysis.system_prompt };
        }
        if (analysis.model !== agent.model) {
          proposedChanges.model = { from: agent.model, to: analysis.model };
        }
        if (analysis.memory_enabled !== agent.memory_enabled) {
          proposedChanges.memoryEnabled = { from: agent.memory_enabled, to: analysis.memory_enabled };
        }
        if (analysis.respond_to_all_messages !== agent.respond_to_all_messages) {
          proposedChanges.respondToAllMessages = {
            from: agent.respond_to_all_messages,
            to: analysis.respond_to_all_messages,
          };
        }
        if (analysis.mentions_only !== agent.mentions_only) {
          proposedChanges.mentionsOnly = { from: agent.mentions_only, to: analysis.mentions_only };
        }
        if (JSON.stringify(analysis.tools) !== JSON.stringify(agent.tools)) {
          proposedChanges.tools = { from: agent.tools, to: analysis.tools };
        }

        const changeCount = Object.keys(proposedChanges).length;
        const response = changeCount > 0
          ? `I've analyzed your request and have ${changeCount} proposed change${changeCount === 1 ? '' : 's'} for "${agent.name}". ${analysis.summary}${!canModify ? '\n\nNote: You do not have permission to modify this agent. Contact an owner or admin to apply these changes.' : ''}`
          : `No changes needed. The agent "${agent.name}" is already configured as described. ${analysis.summary}`;

        res.json({
          response,
          proposedChanges: changeCount > 0 ? proposedChanges : undefined,
          canApply: canModify && changeCount > 0,
        });
      } catch (err: any) {
        logger.error('Chat goal analysis failed', { error: err.message, agentId });
        res.json({
          response: `I encountered an issue analyzing your request: ${err.message}. Please try rephrasing your message.`,
        });
      }
      return;
    }

    // General question (no agent context) - provide helpful guidance
    const agents = await listAgents(workspaceId);
    const agentNames = agents.slice(0, 5).map(a => a.name).join(', ');

    let response: string;
    if (context === 'dashboard') {
      response = `You have ${agents.length} agent${agents.length === 1 ? '' : 's'} configured${agentNames ? ` (${agentNames})` : ''}. You can select an agent from the dropdown above to update its configuration, or navigate to an agent's detail page for a full view.`;
    } else if (context === 'tools') {
      response = 'To manage tool integrations, use the controls on this page. You can add new integrations, configure API keys, and control which agents have access to each tool.';
    } else if (context === 'kb') {
      response = 'You can manage your knowledge base from this page. Add articles, sync sources, and configure search settings. Select an agent from the dropdown to ask questions about its knowledge base.';
    } else {
      response = `I can help you update agent configurations. Select an agent from the dropdown above, then describe what changes you'd like to make. For example: "Make this agent respond to all messages" or "Add the Linear tool".${agentNames ? ` Your agents: ${agentNames}.` : ''}`;
    }

    res.json({ response });
  } catch (err: any) {
    logger.error('Chat error', { error: err.message });
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

export default router;
