import type { App } from '@slack/bolt';
import { approveContribution } from '../modules/kb-wizard';
import { approveProposal, rejectProposal } from '../modules/self-evolution';
import { resolveHumanAction } from '../modules/workflows';
import { postMessage } from './index';
import { getDefaultWorkspaceId } from '../db';
import { logger } from '../utils/logger';

export function registerActions(app: App): void {
  // ── KB Approval ──
  app.action('kb_approve', async ({ action, ack, body }) => {
    await ack();
    const actionData = action as any;
    const entryId = actionData.value;
    const userId = (body as any).user?.id;
    const workspaceId = (body as any).team?.id || getDefaultWorkspaceId();

    try {
      const entry = await approveContribution(workspaceId, entryId);
      await postMessage(
        (body as any).channel?.id || '',
        `:white_check_mark: KB entry "${entry.title}" approved by <@${userId}>`,
      );
    } catch (err: any) {
      logger.error('KB approval failed', { entryId, error: err.message });
    }
  });

  app.action('kb_reject', async ({ action, ack, body }) => {
    await ack();
    const actionData = action as any;
    const entryId = actionData.value;
    const userId = (body as any).user?.id;
    const workspaceId = (body as any).team?.id || getDefaultWorkspaceId();

    const { deleteKBEntry } = await import('../modules/knowledge-base');
    await deleteKBEntry(workspaceId, entryId);

    await postMessage(
      (body as any).channel?.id || '',
      `:x: KB entry rejected by <@${userId}>`,
    );
  });

  // ── Evolution Proposal Approval ──
  app.action('evolution_approve', async ({ action, ack, body }) => {
    await ack();
    const actionData = action as any;
    const proposalId = actionData.value;
    const userId = (body as any).user?.id;
    const workspaceId = (body as any).team?.id || getDefaultWorkspaceId();

    try {
      const proposal = await approveProposal(workspaceId, proposalId, userId);
      await postMessage(
        (body as any).channel?.id || '',
        `:white_check_mark: Evolution proposal approved: ${proposal.description}`,
      );
    } catch (err: any) {
      logger.error('Evolution approval failed', { proposalId, error: err.message });
    }
  });

  app.action('evolution_reject', async ({ action, ack, body }) => {
    await ack();
    const actionData = action as any;
    const proposalId = actionData.value;
    const userId = (body as any).user?.id;
    const workspaceId = (body as any).team?.id || getDefaultWorkspaceId();

    try {
      await rejectProposal(workspaceId, proposalId, userId);
      await postMessage(
        (body as any).channel?.id || '',
        `:x: Evolution proposal rejected by <@${userId}>`,
      );
    } catch (err: any) {
      logger.error('Evolution rejection failed', { proposalId, error: err.message });
    }
  });

  // ── Workflow Human Action ──
  app.action('workflow_action', async ({ action, ack, body }) => {
    await ack();
    const actionData = action as any;
    const workspaceId = (body as any).team?.id || getDefaultWorkspaceId();

    try {
      const { workflowRunId, actionData: data } = JSON.parse(actionData.value);
      await resolveHumanAction(workspaceId, workflowRunId, data);

      await postMessage(
        (body as any).channel?.id || '',
        ':arrow_forward: Workflow resumed',
      );
    } catch (err: any) {
      logger.error('Workflow action failed', { error: err.message });
    }
  });

  // ── Trigger Management ──
  app.action('trigger_pause', async ({ action, ack, body }) => {
    await ack();
    const { pauseTrigger } = await import('../modules/triggers');
    const actionData = action as any;
    const userId = (body as any).user?.id;
    const workspaceId = (body as any).team?.id || getDefaultWorkspaceId();

    try {
      await pauseTrigger(workspaceId, actionData.value, userId);
      await postMessage(
        (body as any).channel?.id || '',
        ':pause_button: Trigger paused',
      );
    } catch (err: any) {
      logger.error('Trigger pause failed', { error: err.message });
    }
  });

  app.action('trigger_resume', async ({ action, ack, body }) => {
    await ack();
    const { resumeTrigger } = await import('../modules/triggers');
    const actionData = action as any;
    const userId = (body as any).user?.id;
    const workspaceId = (body as any).team?.id || getDefaultWorkspaceId();

    try {
      await resumeTrigger(workspaceId, actionData.value, userId);
      await postMessage(
        (body as any).channel?.id || '',
        ':arrow_forward: Trigger resumed',
      );
    } catch (err: any) {
      logger.error('Trigger resume failed', { error: err.message });
    }
  });
}
