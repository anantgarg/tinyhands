import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──
// We need to mock all the sub-integration modules before importing the index

vi.mock('../../src/modules/tools/integrations/chargebee', () => ({
  manifest: {
    id: 'chargebee',
    label: 'Chargebee',
    icon: ':credit_card:',
    description: 'Chargebee integration',
    configKeys: ['api_key', 'site'],
    configPlaceholders: { api_key: 'live_xxx', site: 'your-subdomain' },
    tools: [
      { name: 'chargebee-read', schema: '{}', code: '', accessLevel: 'read-only', displayName: 'Checking Chargebee' },
      { name: 'chargebee-write', schema: '{}', code: '', accessLevel: 'read-write', displayName: 'Updating Chargebee' },
    ],
    register: vi.fn(),
    updateConfig: vi.fn(),
  },
}));

vi.mock('../../src/modules/tools/integrations/hubspot', () => ({
  manifest: {
    id: 'hubspot',
    label: 'HubSpot',
    icon: ':handshake:',
    description: 'HubSpot CRM',
    configKeys: ['access_token'],
    tools: [
      { name: 'hubspot-read', schema: '{}', code: '', accessLevel: 'read-only', displayName: 'Checking HubSpot' },
      { name: 'hubspot-write', schema: '{}', code: '', accessLevel: 'read-write', displayName: 'Updating HubSpot' },
    ],
    register: vi.fn(),
    updateConfig: vi.fn(),
  },
}));

vi.mock('../../src/modules/tools/integrations/kb', () => ({
  manifest: {
    id: 'kb',
    label: 'Knowledge Base',
    icon: ':books:',
    description: 'KB search',
    configKeys: [],
    tools: [
      { name: 'kb-search', schema: '{}', code: '', accessLevel: 'read-only', displayName: 'Searching knowledge base' },
    ],
    register: vi.fn(),
    updateConfig: vi.fn(),
  },
}));

vi.mock('../../src/modules/tools/integrations/linear', () => ({
  manifest: {
    id: 'linear',
    label: 'Linear',
    icon: ':bar_chart:',
    description: 'Linear integration',
    configKeys: ['api_key'],
    tools: [
      { name: 'linear-read', schema: '{}', code: '', accessLevel: 'read-only', displayName: 'Checking Linear' },
    ],
    register: vi.fn(),
    updateConfig: vi.fn(),
  },
}));

vi.mock('../../src/modules/tools/integrations/posthog', () => ({
  manifest: {
    id: 'posthog',
    label: 'PostHog',
    icon: ':chart_with_upwards_trend:',
    description: 'PostHog analytics',
    configKeys: ['api_key', 'project_id'],
    tools: [
      { name: 'posthog-read', schema: '{}', code: '', accessLevel: 'read-only', displayName: 'Checking PostHog' },
    ],
    register: vi.fn(),
    updateConfig: vi.fn(),
  },
}));

vi.mock('../../src/modules/tools/integrations/serpapi', () => ({
  manifest: {
    id: 'serpapi',
    label: 'SerpAPI',
    icon: ':mag:',
    description: 'SERP rankings',
    configKeys: ['api_key'],
    tools: [
      { name: 'serpapi-read', schema: '{}', code: '', accessLevel: 'read-only', displayName: 'Searching SerpAPI' },
    ],
    register: vi.fn(),
    updateConfig: vi.fn(),
  },
}));

vi.mock('../../src/modules/tools/integrations/zendesk', () => ({
  manifest: {
    id: 'zendesk',
    label: 'Zendesk',
    icon: ':ticket:',
    description: 'Zendesk support',
    configKeys: ['subdomain', 'email', 'api_token'],
    tools: [
      { name: 'zendesk-read', schema: '{}', code: '', accessLevel: 'read-only', displayName: 'Checking Zendesk' },
      { name: 'zendesk-write', schema: '{}', code: '', accessLevel: 'read-write', displayName: 'Updating Zendesk' },
    ],
    register: vi.fn(),
    updateConfig: vi.fn(),
  },
}));

import {
  getIntegrations,
  getIntegration,
  getToolIntegrations,
  getToolDisplayNames,
} from '../../src/modules/tools/integrations/index';

// ── Tests ──

describe('Tool Integrations Index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getIntegrations', () => {
    it('should return all integration manifests', () => {
      const integrations = getIntegrations();
      expect(integrations).toHaveLength(7);
      const ids = integrations.map(m => m.id);
      expect(ids).toContain('chargebee');
      expect(ids).toContain('hubspot');
      expect(ids).toContain('kb');
      expect(ids).toContain('linear');
      expect(ids).toContain('posthog');
      expect(ids).toContain('serpapi');
      expect(ids).toContain('zendesk');
    });
  });

  describe('getIntegration', () => {
    it('should return the manifest for a known id', () => {
      const result = getIntegration('chargebee');
      expect(result).toBeDefined();
      expect(result!.id).toBe('chargebee');
      expect(result!.label).toBe('Chargebee');
    });

    it('should return undefined for an unknown id', () => {
      const result = getIntegration('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('getToolIntegrations', () => {
    it('should return an array of integration objects with correct shape', () => {
      const integrations = getToolIntegrations();
      expect(integrations).toHaveLength(7);

      const chargebee = integrations.find(i => i.id === 'chargebee');
      expect(chargebee).toBeDefined();
      expect(chargebee!.label).toBe('Chargebee');
      expect(chargebee!.icon).toBe(':credit_card:');
      expect(chargebee!.description).toBe('Chargebee integration');
      expect(chargebee!.tools).toEqual(['chargebee-read', 'chargebee-write']);
      expect(chargebee!.requiredConfigKeys).toEqual(['api_key', 'site']);
      expect(chargebee!.configPlaceholders).toEqual({ api_key: 'live_xxx', site: 'your-subdomain' });
    });

    it('should return empty configPlaceholders when not defined', () => {
      const integrations = getToolIntegrations();
      const hubspot = integrations.find(i => i.id === 'hubspot');
      expect(hubspot!.configPlaceholders).toEqual({});
    });

    it('should map tool names from manifest tools', () => {
      const integrations = getToolIntegrations();
      const kb = integrations.find(i => i.id === 'kb');
      expect(kb!.tools).toEqual(['kb-search']);
    });
  });

  describe('getToolDisplayNames', () => {
    it('should return a map of tool names to display names', () => {
      const displayNames = getToolDisplayNames();

      expect(displayNames['chargebee-read']).toBe('Checking Chargebee');
      expect(displayNames['chargebee-write']).toBe('Updating Chargebee');
      expect(displayNames['hubspot-read']).toBe('Checking HubSpot');
      expect(displayNames['hubspot-write']).toBe('Updating HubSpot');
      expect(displayNames['kb-search']).toBe('Searching knowledge base');
      expect(displayNames['serpapi-read']).toBe('Searching SerpAPI');
    });

    it('should include all tools from all integrations', () => {
      const displayNames = getToolDisplayNames();
      const keys = Object.keys(displayNames);

      // Count total tools across all integrations
      const totalTools = getIntegrations().reduce((sum, m) => sum + m.tools.length, 0);
      expect(keys.length).toBe(totalTools);
    });
  });
});
