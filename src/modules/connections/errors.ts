import type { ConnectionMode, PlatformRole, AgentAccessLevel } from '../../types';

export interface CredentialErrorContext {
  mode: ConnectionMode | null;
  integrationId: string;
  integrationLabel: string;
  integrationIcon: string;
  runnerPlatformRole: PlatformRole;
  runnerAgentRole: AgentAccessLevel;
  agentOwnerIds: string[];
  isRunnerOwner: boolean;
  isRunnerAdmin: boolean;
}

export interface CredentialErrorResult {
  message: string;
  blocks: any[];
  showConnectButton: boolean;
}

export function buildCredentialError(ctx: CredentialErrorContext): CredentialErrorResult {
  const effectiveMode: ConnectionMode = ctx.mode || 'team';

  switch (effectiveMode) {
    case 'team':
      return buildTeamModeError(ctx);
    case 'delegated':
      return buildDelegatedModeError(ctx);
    case 'runtime':
      return buildRuntimeModeError(ctx);
  }
}

function buildTeamModeError(ctx: CredentialErrorContext): CredentialErrorResult {
  const { integrationLabel: label, integrationIcon: icon } = ctx;

  if (ctx.isRunnerAdmin) {
    return {
      message: `Missing shared ${label} credentials (admin)`,
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: `${icon} The shared *${label}* credentials haven't been set up yet. Go to the *Connections* page in the dashboard to configure them.` },
      }],
      showConnectButton: false,
    };
  }

  if (ctx.isRunnerOwner) {
    return {
      message: `Missing shared ${label} credentials`,
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: `${icon} This agent uses shared *${label}* credentials, but they haven't been set up by an admin yet. Ask a workspace admin to connect *${label}* in the Connections page.` },
      }],
      showConnectButton: false,
    };
  }

  const ownerMentions = ctx.agentOwnerIds.map(id => `<@${id}>`).join(' or ');
  return {
    message: `Missing shared ${label} credentials`,
    blocks: [{
      type: 'section',
      text: { type: 'mrkdwn', text: `${icon} This agent uses shared *${label}* credentials, but they aren't configured yet. Let ${ownerMentions || 'a workspace admin'} know.` },
    }],
    showConnectButton: false,
  };
}

function buildDelegatedModeError(ctx: CredentialErrorContext): CredentialErrorResult {
  const { integrationLabel: label, integrationIcon: icon } = ctx;

  if (ctx.isRunnerOwner) {
    return {
      message: `Missing ${label} credentials for agent owner`,
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: `${icon} This agent uses your *${label}* credentials, but you haven't connected *${label}* yet.` },
      }],
      showConnectButton: true,
    };
  }

  if (ctx.isRunnerAdmin) {
    const ownerMentions = ctx.agentOwnerIds.map(id => `<@${id}>`).join(' or ');
    return {
      message: `Missing ${label} credentials for agent owner`,
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: `${icon} This agent uses ${ownerMentions || "the owner"}'s *${label}* credentials, but they haven't connected yet. Let them know they need to connect *${label}*.` },
      }],
      showConnectButton: false,
    };
  }

  const ownerMentions = ctx.agentOwnerIds.map(id => `<@${id}>`).join(' or ');
  return {
    message: `Missing ${label} credentials for agent owner`,
    blocks: [{
      type: 'section',
      text: { type: 'mrkdwn', text: `${icon} This agent uses the owner's *${label}* credentials, but they aren't set up yet. Let ${ownerMentions || 'the agent owner'} know.` },
    }],
    showConnectButton: false,
  };
}

function buildRuntimeModeError(ctx: CredentialErrorContext): CredentialErrorResult {
  const { integrationLabel: label } = ctx;
  return {
    message: `Missing ${label} credentials for user`,
    blocks: [{
      type: 'section',
      text: { type: 'mrkdwn', text: `:key: I need your *${label}* credentials to proceed.` },
    }],
    showConnectButton: true,
  };
}
