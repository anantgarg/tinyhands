import { describe, it, expect } from 'vitest';

import {
  CONNECTORS,
  normalizeConnectorType,
  getConnector,
  getProviderForConnector,
  listConnectors,
} from '../../src/modules/kb-sources/connectors';
import type { ConnectorDef } from '../../src/modules/kb-sources/connectors';

describe('KB Source Connectors', () => {

  // ── CONNECTORS record ──

  describe('CONNECTORS', () => {
    const expectedTypes = [
      'google_drive',
      'zendesk_help_center',
      'website',
      'github',
      'hubspot_kb',
      'linear_docs',
    ] as const;

    it('should have exactly 6 connectors', () => {
      expect(Object.keys(CONNECTORS)).toHaveLength(6);
    });

    it.each(expectedTypes)('should contain connector "%s"', (type) => {
      expect(CONNECTORS[type]).toBeDefined();
    });

    it.each(expectedTypes)('connector "%s" should have all required fields', (type) => {
      const connector = CONNECTORS[type];
      expect(connector.type).toBe(type);
      expect(typeof connector.label).toBe('string');
      expect(connector.label.length).toBeGreaterThan(0);
      expect(typeof connector.icon).toBe('string');
      expect(connector.icon.length).toBeGreaterThan(0);
      expect(typeof connector.provider).toBe('string');
      expect(connector.provider.length).toBeGreaterThan(0);
      expect(typeof connector.description).toBe('string');
      expect(connector.description.length).toBeGreaterThan(0);
      expect(Array.isArray(connector.requiredKeys)).toBe(true);
      expect(connector.requiredKeys.length).toBeGreaterThan(0);
      expect(Array.isArray(connector.setupSteps)).toBe(true);
      expect(connector.setupSteps.length).toBeGreaterThan(0);
      expect(Array.isArray(connector.configFields)).toBe(true);
    });

    it.each(expectedTypes)('connector "%s" configFields should have key, label, and either a placeholder or a non-text type', (type) => {
      const connector = CONNECTORS[type];
      for (const field of connector.configFields) {
        expect(typeof field.key).toBe('string');
        expect(field.key.length).toBeGreaterThan(0);
        expect(typeof field.label).toBe('string');
        expect(field.label.length).toBeGreaterThan(0);
        const fieldType = field.type ?? 'text';
        if (fieldType === 'text') {
          expect(typeof field.placeholder).toBe('string');
          expect((field.placeholder ?? '').length).toBeGreaterThan(0);
        }
      }
    });

    describe('google_drive', () => {
      it('should have correct metadata', () => {
        const c = CONNECTORS.google_drive;
        expect(c.label).toBe('Google Drive');
        expect(c.provider).toBe('google');
        expect(c.icon).toBe(':file_folder:');
      });

      it('should require OAuth credentials', () => {
        const c = CONNECTORS.google_drive;
        expect(c.requiredKeys).toContain('client_id');
        expect(c.requiredKeys).toContain('client_secret');
        expect(c.requiredKeys).toContain('refresh_token');
        expect(c.requiredKeys).toHaveLength(3);
      });

      it('should have folder_id config field', () => {
        const c = CONNECTORS.google_drive;
        expect(c.configFields.find(f => f.key === 'folder_id')).toBeDefined();
      });

      it('should have file_types as optional config field', () => {
        const c = CONNECTORS.google_drive;
        const fileTypes = c.configFields.find(f => f.key === 'file_types');
        expect(fileTypes).toBeDefined();
        expect(fileTypes!.optional).toBe(true);
      });
    });

    describe('zendesk_help_center', () => {
      it('should have correct metadata', () => {
        const c = CONNECTORS.zendesk_help_center;
        expect(c.label).toBe('Zendesk Help Center');
        expect(c.provider).toBe('zendesk');
        expect(c.icon).toBe(':ticket:');
      });

      it('should require subdomain, email, api_token', () => {
        const c = CONNECTORS.zendesk_help_center;
        expect(c.requiredKeys).toEqual(['subdomain', 'email', 'api_token']);
      });
    });

    describe('website', () => {
      it('should have correct metadata', () => {
        const c = CONNECTORS.website;
        expect(c.label).toBe('Website');
        expect(c.provider).toBe('firecrawl');
        expect(c.icon).toBe(':globe_with_meridians:');
      });

      it('should require only api_key', () => {
        expect(CONNECTORS.website.requiredKeys).toEqual(['api_key']);
      });

      it('should have url config field', () => {
        expect(CONNECTORS.website.configFields.find(f => f.key === 'url')).toBeDefined();
      });

      it('should have optional max_pages, include_paths, and exclude_paths', () => {
        const c = CONNECTORS.website;
        expect(c.configFields.find(f => f.key === 'max_pages')?.optional).toBe(true);
        expect(c.configFields.find(f => f.key === 'include_paths')?.optional).toBe(true);
        expect(c.configFields.find(f => f.key === 'exclude_paths')?.optional).toBe(true);
      });
    });

    describe('github', () => {
      it('should have correct metadata', () => {
        const c = CONNECTORS.github;
        expect(c.label).toBe('GitHub');
        expect(c.provider).toBe('github');
        expect(c.icon).toBe(':computer:');
      });

      it('should require only token', () => {
        expect(CONNECTORS.github.requiredKeys).toEqual(['token']);
      });

      it('should have repo as a required config field', () => {
        const repoField = CONNECTORS.github.configFields.find(f => f.key === 'repo');
        expect(repoField).toBeDefined();
        expect(repoField!.optional).toBeUndefined();
      });

      it('should have branch, paths, content_type as optional', () => {
        const c = CONNECTORS.github;
        expect(c.configFields.find(f => f.key === 'branch')?.optional).toBe(true);
        expect(c.configFields.find(f => f.key === 'paths')?.optional).toBe(true);
        expect(c.configFields.find(f => f.key === 'content_type')?.optional).toBe(true);
      });
    });

    describe('hubspot_kb', () => {
      it('should have correct metadata', () => {
        const c = CONNECTORS.hubspot_kb;
        expect(c.label).toBe('HubSpot Knowledge Base');
        expect(c.provider).toBe('hubspot');
        expect(c.icon).toBe(':orange_book:');
      });

      it('should require access_token', () => {
        expect(CONNECTORS.hubspot_kb.requiredKeys).toEqual(['access_token']);
      });

      it('should have portal_id config field', () => {
        expect(CONNECTORS.hubspot_kb.configFields.find(f => f.key === 'portal_id')).toBeDefined();
      });
    });

    describe('linear_docs', () => {
      it('should have correct metadata', () => {
        const c = CONNECTORS.linear_docs;
        expect(c.label).toBe('Linear Docs');
        expect(c.provider).toBe('linear');
        expect(c.icon).toBe(':pencil2:');
      });

      it('should require api_key', () => {
        expect(CONNECTORS.linear_docs.requiredKeys).toEqual(['api_key']);
      });

      it('should have team_key, include_issues, include_projects as optional config fields', () => {
        const c = CONNECTORS.linear_docs;
        expect(c.configFields.find(f => f.key === 'team_key')?.optional).toBe(true);
        expect(c.configFields.find(f => f.key === 'include_issues')?.optional).toBe(true);
        expect(c.configFields.find(f => f.key === 'include_projects')?.optional).toBe(true);
      });
    });
  });

  // ── normalizeConnectorType ──

  describe('normalizeConnectorType', () => {
    it('should map "firecrawl" to "website"', () => {
      expect(normalizeConnectorType('firecrawl')).toBe('website');
    });

    it('should map "reducto" to "google_drive"', () => {
      expect(normalizeConnectorType('reducto')).toBe('google_drive');
    });

    it('should pass through current connector types unchanged', () => {
      expect(normalizeConnectorType('google_drive')).toBe('google_drive');
      expect(normalizeConnectorType('zendesk_help_center')).toBe('zendesk_help_center');
      expect(normalizeConnectorType('website')).toBe('website');
      expect(normalizeConnectorType('github')).toBe('github');
      expect(normalizeConnectorType('hubspot_kb')).toBe('hubspot_kb');
      expect(normalizeConnectorType('linear_docs')).toBe('linear_docs');
    });

    it('should pass through unknown types as-is', () => {
      expect(normalizeConnectorType('unknown_type')).toBe('unknown_type');
    });
  });

  // ── getConnector ──

  describe('getConnector', () => {
    it('should return connector definition for a valid type', () => {
      const connector = getConnector('google_drive');
      expect(connector).toBeDefined();
      expect(connector.type).toBe('google_drive');
      expect(connector.label).toBe('Google Drive');
    });

    it('should return correct connector for each type', () => {
      expect(getConnector('zendesk_help_center').type).toBe('zendesk_help_center');
      expect(getConnector('website').type).toBe('website');
      expect(getConnector('github').type).toBe('github');
      expect(getConnector('hubspot_kb').type).toBe('hubspot_kb');
      expect(getConnector('linear_docs').type).toBe('linear_docs');
    });

    it('should resolve legacy type "firecrawl" to the website connector', () => {
      const connector = getConnector('firecrawl');
      expect(connector.type).toBe('website');
      expect(connector.label).toBe('Website');
    });

    it('should resolve legacy type "reducto" to the google_drive connector', () => {
      const connector = getConnector('reducto');
      expect(connector.type).toBe('google_drive');
      expect(connector.label).toBe('Google Drive');
    });

    it('should return undefined for an unknown type', () => {
      const connector = getConnector('nonexistent' as any);
      expect(connector).toBeUndefined();
    });
  });

  // ── getProviderForConnector ──

  describe('getProviderForConnector', () => {
    it('should return "google" for google_drive', () => {
      expect(getProviderForConnector('google_drive')).toBe('google');
    });

    it('should return "zendesk" for zendesk_help_center', () => {
      expect(getProviderForConnector('zendesk_help_center')).toBe('zendesk');
    });

    it('should return "firecrawl" for website', () => {
      expect(getProviderForConnector('website')).toBe('firecrawl');
    });

    it('should return "github" for github', () => {
      expect(getProviderForConnector('github')).toBe('github');
    });

    it('should return "hubspot" for hubspot_kb', () => {
      expect(getProviderForConnector('hubspot_kb')).toBe('hubspot');
    });

    it('should return "linear" for linear_docs', () => {
      expect(getProviderForConnector('linear_docs')).toBe('linear');
    });

    it('should resolve legacy type "firecrawl" and return its provider "firecrawl"', () => {
      // firecrawl -> website -> provider is 'firecrawl'
      expect(getProviderForConnector('firecrawl')).toBe('firecrawl');
    });

    it('should resolve legacy type "reducto" and return "google"', () => {
      // reducto -> google_drive -> provider is 'google'
      expect(getProviderForConnector('reducto')).toBe('google');
    });
  });

  // ── listConnectors ──

  describe('listConnectors', () => {
    it('should return all 6 connectors', () => {
      const connectors = listConnectors();
      expect(connectors).toHaveLength(6);
    });

    it('should return an array of ConnectorDef objects', () => {
      const connectors = listConnectors();
      for (const connector of connectors) {
        expect(connector).toHaveProperty('type');
        expect(connector).toHaveProperty('label');
        expect(connector).toHaveProperty('icon');
        expect(connector).toHaveProperty('provider');
        expect(connector).toHaveProperty('description');
        expect(connector).toHaveProperty('requiredKeys');
        expect(connector).toHaveProperty('setupSteps');
        expect(connector).toHaveProperty('configFields');
      }
    });

    it('should contain all expected connector types', () => {
      const connectors = listConnectors();
      const types = connectors.map(c => c.type);
      expect(types).toContain('google_drive');
      expect(types).toContain('zendesk_help_center');
      expect(types).toContain('website');
      expect(types).toContain('github');
      expect(types).toContain('hubspot_kb');
      expect(types).toContain('linear_docs');
    });

    it('should not contain legacy types', () => {
      const connectors = listConnectors();
      const types = connectors.map(c => c.type);
      expect(types).not.toContain('firecrawl');
      expect(types).not.toContain('reducto');
    });

    it('should return the same objects as in the CONNECTORS record', () => {
      const connectors = listConnectors();
      for (const connector of connectors) {
        expect(connector).toBe(CONNECTORS[connector.type]);
      }
    });

    it('should have unique types across all connectors', () => {
      const connectors = listConnectors();
      const types = connectors.map(c => c.type);
      const uniqueTypes = new Set(types);
      expect(uniqueTypes.size).toBe(types.length);
    });

    it('should have unique labels across all connectors', () => {
      const connectors = listConnectors();
      const labels = connectors.map(c => c.label);
      const uniqueLabels = new Set(labels);
      expect(uniqueLabels.size).toBe(labels.length);
    });
  });
});
