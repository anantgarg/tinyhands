import { describe, it, expect } from 'vitest';
import {
  friendlyModel,
  friendlyAgentStatus,
  friendlyKbSourceStatus,
  friendlyRunStatus,
  friendlyAuditAction,
  friendlyAuditStatus,
} from '../../src/utils/labels';

describe('friendlyModel', () => {
  it('returns "Opus" for any opus variant', () => {
    expect(friendlyModel('claude-opus-4-7')).toBe('Opus');
    expect(friendlyModel('opus')).toBe('Opus');
  });

  it('returns "Haiku" for any haiku variant', () => {
    expect(friendlyModel('claude-haiku-4-5-20251001')).toBe('Haiku');
    expect(friendlyModel('haiku')).toBe('Haiku');
  });

  it('returns "Sonnet" for any sonnet variant', () => {
    expect(friendlyModel('claude-sonnet-4-6')).toBe('Sonnet');
    expect(friendlyModel('sonnet')).toBe('Sonnet');
  });

  it('defaults to "Sonnet" for unknown or missing values, "Unknown" for falsy', () => {
    expect(friendlyModel(null)).toBe('Unknown');
    expect(friendlyModel(undefined)).toBe('Unknown');
    expect(friendlyModel('')).toBe('Unknown');
    expect(friendlyModel('something-else')).toBe('Sonnet');
  });
});

describe('friendlyAgentStatus', () => {
  it('maps every known status', () => {
    expect(friendlyAgentStatus('active')).toBe('Running');
    expect(friendlyAgentStatus('paused')).toBe('Paused');
    expect(friendlyAgentStatus('archived')).toBe('Archived');
    expect(friendlyAgentStatus('error')).toBe('Error');
  });

  it('returns "Unknown" for unexpected input', () => {
    expect(friendlyAgentStatus('weird')).toBe('Unknown');
    expect(friendlyAgentStatus(null)).toBe('Unknown');
    expect(friendlyAgentStatus(undefined)).toBe('Unknown');
  });
});

describe('friendlyKbSourceStatus', () => {
  it('maps every known KB source status', () => {
    expect(friendlyKbSourceStatus('active')).toBe('Active');
    expect(friendlyKbSourceStatus('syncing')).toBe('Syncing');
    expect(friendlyKbSourceStatus('error')).toBe('Error');
    expect(friendlyKbSourceStatus('needs_setup')).toBe('Setup needed');
  });

  it('returns "Unknown" for unexpected input', () => {
    expect(friendlyKbSourceStatus('archived')).toBe('Unknown');
    expect(friendlyKbSourceStatus(null)).toBe('Unknown');
  });
});

describe('friendlyRunStatus', () => {
  it('maps canonical run statuses', () => {
    expect(friendlyRunStatus('completed')).toBe('Completed');
    expect(friendlyRunStatus('failed')).toBe('Failed');
    expect(friendlyRunStatus('running')).toBe('Running');
    expect(friendlyRunStatus('queued')).toBe('Queued');
    expect(friendlyRunStatus('timeout')).toBe('Timed out');
  });

  it('maps alternate status strings to the same friendly labels', () => {
    expect(friendlyRunStatus('success')).toBe('Completed');
    expect(friendlyRunStatus('error')).toBe('Failed');
    expect(friendlyRunStatus('failure')).toBe('Failed');
    expect(friendlyRunStatus('in_progress')).toBe('Running');
    expect(friendlyRunStatus('pending')).toBe('Queued');
  });

  it('returns "Unknown" for unexpected input', () => {
    expect(friendlyRunStatus('something-new')).toBe('Unknown');
    expect(friendlyRunStatus(null)).toBe('Unknown');
    expect(friendlyRunStatus(undefined)).toBe('Unknown');
  });
});

describe('friendlyAuditAction', () => {
  it('maps every canonical audit action type', () => {
    expect(friendlyAuditAction('tool_invocation')).toBe('Tool invoked');
    expect(friendlyAuditAction('agent_config_change')).toBe('Agent configuration updated');
    expect(friendlyAuditAction('role_change')).toBe('Role changed');
    expect(friendlyAuditAction('connection_created')).toBe('Connection added');
    expect(friendlyAuditAction('connection_deleted')).toBe('Connection removed');
    expect(friendlyAuditAction('upgrade_approved')).toBe('Access upgrade approved');
    expect(friendlyAuditAction('upgrade_denied')).toBe('Access upgrade denied');
    expect(friendlyAuditAction('agent_created')).toBe('Agent created');
    expect(friendlyAuditAction('agent_deleted')).toBe('Agent deleted');
    expect(friendlyAuditAction('platform_role_changed')).toBe('Platform role changed');
  });

  it('title-cases unknown action types as a sensible fallback', () => {
    expect(friendlyAuditAction('custom_new_action')).toBe('Custom New Action');
  });

  it('handles missing input', () => {
    expect(friendlyAuditAction(null)).toBe('Unknown action');
    expect(friendlyAuditAction(undefined)).toBe('Unknown action');
    expect(friendlyAuditAction('')).toBe('Unknown action');
  });
});

describe('friendlyAuditStatus', () => {
  it('maps the audit status enum to friendly labels', () => {
    expect(friendlyAuditStatus('success')).toBe('Succeeded');
    expect(friendlyAuditStatus('failure')).toBe('Failed');
    expect(friendlyAuditStatus('error')).toBe('Failed');
  });

  it('title-cases unknown status strings', () => {
    expect(friendlyAuditStatus('pending')).toBe('Pending');
  });

  it('returns "Unknown" for falsy values', () => {
    expect(friendlyAuditStatus(null)).toBe('Unknown');
    expect(friendlyAuditStatus(undefined)).toBe('Unknown');
    expect(friendlyAuditStatus('')).toBe('Unknown');
  });
});
