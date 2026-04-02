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
}

export function buildCredentialError(ctx: CredentialErrorContext): CredentialErrorResult {
  if (!ctx.mode) {
    return buildNotConfiguredError(ctx);
  }

  switch (ctx.mode) {
    case 'team':
      return buildTeamModeError(ctx);
    case 'delegated':
      return buildDelegatedModeError(ctx);
    case 'runtime':
      return buildRuntimeModeError(ctx);
  }
}

function buildNotConfiguredError(ctx: CredentialErrorContext): CredentialErrorResult {
  const { integrationLabel: label, integrationIcon: icon } = ctx;

  if (ctx.isRunnerAdmin || ctx.isRunnerOwner) {
    return {
      message: `${label} credentials not configured`,
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: `${icon} *${label}* credentials haven't been configured for this agent yet. Open the agent's settings in the dashboard and choose a credential mode for *${label}*.` },
      }],
    };
  }

  const ownerMentions = ctx.agentOwnerIds.map(id => `<@${id}>`).join(' or ');
  return {
    message: `${label} credentials not configured`,
    blocks: [{
      type: 'section',
      text: { type: 'mrkdwn', text: `${icon} *${label}* credentials haven't been configured for this agent yet. Let ${ownerMentions || 'the agent owner'} know.` },
    }],
  };
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
    };
  }

  if (ctx.isRunnerOwner) {
    return {
      message: `Missing shared ${label} credentials`,
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: `${icon} This agent uses shared *${label}* credentials, but they haven't been set up by an admin yet. Ask a workspace admin to connect *${label}* in the Connections page.` },
      }],
    };
  }

  const ownerMentions = ctx.agentOwnerIds.map(id => `<@${id}>`).join(' or ');
  return {
    message: `Missing shared ${label} credentials`,
    blocks: [{
      type: 'section',
      text: { type: 'mrkdwn', text: `${icon} This agent uses shared *${label}* credentials, but they aren't configured yet. Let ${ownerMentions || 'a workspace admin'} know.` },
    }],
  };
}

function buildDelegatedModeError(ctx: CredentialErrorContext): CredentialErrorResult {
  const { integrationLabel: label, integrationIcon: icon } = ctx;

  if (ctx.isRunnerOwner) {
    return {
      message: `Missing ${label} credentials for agent owner`,
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: `${icon} This agent uses your *${label}* credentials, but you haven't connected *${label}* yet. Go to the Connections page in the TinyHands dashboard to set it up.` },
      }],
    };
  }

  if (ctx.isRunnerAdmin) {
    const ownerMentions = ctx.agentOwnerIds.map(id => `<@${id}>`).join(' or ');
    return {
      message: `Missing ${label} credentials for agent owner`,
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: `${icon} This agent uses ${ownerMentions || "the owner"}'s *${label}* credentials, but they haven't connected yet. Let them know they need to connect *${label}* in the TinyHands dashboard.` },
      }],
    };
  }

  const ownerMentions = ctx.agentOwnerIds.map(id => `<@${id}>`).join(' or ');
  return {
    message: `Missing ${label} credentials for agent owner`,
    blocks: [{
      type: 'section',
      text: { type: 'mrkdwn', text: `${icon} This agent uses the owner's *${label}* credentials, but they aren't set up yet. Let ${ownerMentions || 'the agent owner'} know — they need to connect *${label}* in the TinyHands dashboard.` },
    }],
  };
}

function buildRuntimeModeError(ctx: CredentialErrorContext): CredentialErrorResult {
  const { integrationLabel: label } = ctx;
  return {
    message: `Missing ${label} credentials for user`,
    blocks: [{
      type: 'section',
      text: { type: 'mrkdwn', text: `:key: I need your *${label}* credentials to proceed. Go to the Connections page in the TinyHands dashboard to connect it.` },
    }],
  };
}
