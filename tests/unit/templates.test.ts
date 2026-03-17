import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAllTemplates,
  getTemplateById,
  getTemplatesByCategory,
  resolveCustomTools,
  _resetCache,
} from '../../src/modules/templates';
import type { TemplateCategory } from '../../src/modules/templates';

describe('Templates Module', () => {
  beforeEach(() => {
    _resetCache();
  });

  describe('getAllTemplates', () => {
    it('should load all 10 templates', () => {
      const templates = getAllTemplates();
      expect(templates).toHaveLength(10);
    });

    it('should return cached results on second call', () => {
      const first = getAllTemplates();
      const second = getAllTemplates();
      expect(first).toBe(second); // same reference
    });

    it('all templates should have required fields', () => {
      for (const t of getAllTemplates()) {
        expect(t.id).toBeTruthy();
        expect(t.name).toBeTruthy();
        expect(t.emoji).toBeTruthy();
        expect(t.category).toBeTruthy();
        expect(t.description).toBeTruthy();
        expect(t.model).toBeTruthy();
        expect(t.systemPrompt).toBeTruthy();
        expect(typeof t.memory_enabled).toBe('boolean');
        expect(typeof t.mentions_only).toBe('boolean');
        expect(typeof t.respond_to_all_messages).toBe('boolean');
        expect(typeof t.max_turns).toBe('number');
        expect(Array.isArray(t.tools)).toBe(true);
        expect(Array.isArray(t.custom_tools)).toBe(true);
        expect(Array.isArray(t.skills)).toBe(true);
        expect(Array.isArray(t.relevance_keywords)).toBe(true);
      }
    });

    it('all template IDs should be unique', () => {
      const ids = getAllTemplates().map(t => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('all template names should be unique', () => {
      const names = getAllTemplates().map(t => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('all templates should have valid models', () => {
      const validModels = ['haiku', 'sonnet', 'opus'];
      for (const t of getAllTemplates()) {
        expect(validModels).toContain(t.model);
      }
    });

    it('all templates should have non-empty system prompts', () => {
      for (const t of getAllTemplates()) {
        expect(t.systemPrompt.length).toBeGreaterThan(100);
      }
    });

    it('all templates should have relevance keywords', () => {
      for (const t of getAllTemplates()) {
        expect(t.relevance_keywords.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getTemplateById', () => {
    it('should return a template by ID', () => {
      const template = getTemplateById('seo-monitor');
      expect(template).toBeDefined();
      expect(template!.name).toBe('SEO Monitor');
      expect(template!.emoji).toBe(':mag:');
    });

    it('should return undefined for unknown ID', () => {
      expect(getTemplateById('nonexistent')).toBeUndefined();
    });

    it('should return each of the 10 templates by ID', () => {
      const expectedIds = [
        'seo-monitor', 'content-strategist', 'social-media-manager', 'brand-monitor',
        'competitor-analyst', 'market-research-analyst', 'marketing-analytics-reporter',
        'email-campaign-optimizer', 'customer-feedback-analyst', 'growth-strategist',
      ];
      for (const id of expectedIds) {
        expect(getTemplateById(id)).toBeDefined();
      }
    });
  });

  describe('getTemplatesByCategory', () => {
    it('should group templates into 5 categories', () => {
      const byCategory = getTemplatesByCategory();
      const categories = Object.keys(byCategory);
      expect(categories).toHaveLength(5);
      expect(categories).toContain('Content & SEO');
      expect(categories).toContain('Social Media');
      expect(categories).toContain('Competitive Intelligence');
      expect(categories).toContain('Analytics & Reporting');
      expect(categories).toContain('Customer & Community');
    });

    it('each category should have 2 templates', () => {
      const byCategory = getTemplatesByCategory();
      for (const [_category, templates] of Object.entries(byCategory)) {
        expect(templates).toHaveLength(2);
      }
    });

    it('Content & SEO should contain SEO Monitor and Content Strategist', () => {
      const byCategory = getTemplatesByCategory();
      const names = byCategory['Content & SEO'].map(t => t.name);
      expect(names).toContain('SEO Monitor');
      expect(names).toContain('Content Strategist');
    });

    it('Social Media should contain Social Media Manager and Brand Monitor', () => {
      const byCategory = getTemplatesByCategory();
      const names = byCategory['Social Media'].map(t => t.name);
      expect(names).toContain('Social Media Manager');
      expect(names).toContain('Brand Monitor');
    });

    it('Competitive Intelligence should contain Competitor Analyst and Market Research Analyst', () => {
      const byCategory = getTemplatesByCategory();
      const names = byCategory['Competitive Intelligence'].map(t => t.name);
      expect(names).toContain('Competitor Analyst');
      expect(names).toContain('Market Research Analyst');
    });

    it('Analytics & Reporting should contain Marketing Analytics Reporter and Email Campaign Optimizer', () => {
      const byCategory = getTemplatesByCategory();
      const names = byCategory['Analytics & Reporting'].map(t => t.name);
      expect(names).toContain('Marketing Analytics Reporter');
      expect(names).toContain('Email Campaign Optimizer');
    });

    it('Customer & Community should contain Customer Feedback Analyst and Growth Strategist', () => {
      const byCategory = getTemplatesByCategory();
      const names = byCategory['Customer & Community'].map(t => t.name);
      expect(names).toContain('Customer Feedback Analyst');
      expect(names).toContain('Growth Strategist');
    });
  });

  describe('resolveCustomTools', () => {
    it('should resolve all tools when all exist', async () => {
      const toolExists = async (_name: string) => true;
      const result = await resolveCustomTools(['tool-a', 'tool-b'], toolExists);
      expect(result.resolvedTools).toEqual(['tool-a', 'tool-b']);
      expect(result.missingGroups).toEqual([]);
    });

    it('should report missing tools', async () => {
      const toolExists = async (name: string) => name === 'tool-a';
      const result = await resolveCustomTools(['tool-a', 'tool-b'], toolExists);
      expect(result.resolvedTools).toEqual(['tool-a']);
      expect(result.missingGroups).toEqual([['tool-b']]);
    });

    it('should return empty for empty input', async () => {
      const toolExists = async (_name: string) => true;
      const result = await resolveCustomTools([], toolExists);
      expect(result.resolvedTools).toEqual([]);
      expect(result.missingGroups).toEqual([]);
    });

    it('should report all tools as missing when none exist', async () => {
      const toolExists = async (_name: string) => false;
      const result = await resolveCustomTools(['tool-a', 'tool-b'], toolExists);
      expect(result.resolvedTools).toEqual([]);
      expect(result.missingGroups).toEqual([['tool-a'], ['tool-b']]);
    });

    it('should resolve first available alternative with || syntax', async () => {
      const result = await resolveCustomTools(
        ['zendesk-read || hubspot-read'],
        async (name) => name === 'hubspot-read',
      );
      expect(result.resolvedTools).toEqual(['hubspot-read']);
      expect(result.missingGroups).toEqual([]);
    });

    it('should resolve all available alternatives with || syntax', async () => {
      const result = await resolveCustomTools(
        ['zendesk-read || hubspot-read'],
        async () => true,
      );
      expect(result.resolvedTools).toEqual(['zendesk-read', 'hubspot-read']);
      expect(result.missingGroups).toEqual([]);
    });

    it('should report missing group when no alternatives are available', async () => {
      const result = await resolveCustomTools(
        ['zendesk-read || hubspot-read'],
        async () => false,
      );
      expect(result.resolvedTools).toEqual([]);
      expect(result.missingGroups).toEqual([['zendesk-read', 'hubspot-read']]);
    });

    it('should handle mix of single tools and alternatives', async () => {
      const result = await resolveCustomTools(
        ['serpapi-read', 'zendesk-read || hubspot-read'],
        async (name) => name === 'serpapi-read',
      );
      expect(result.resolvedTools).toEqual(['serpapi-read']);
      expect(result.missingGroups).toEqual([['zendesk-read', 'hubspot-read']]);
    });
  });

  describe('template tool names', () => {
    it('all tools should be valid known tool names', () => {
      const knownBuiltinTools = new Set([
        'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash',
        'WebSearch', 'WebFetch', 'LSP', 'NotebookEdit',
      ]);
      for (const t of getAllTemplates()) {
        for (const tool of t.tools) {
          expect(knownBuiltinTools.has(tool)).toBe(true);
        }
      }
    });
  });

  describe('specific template details', () => {
    it('SEO Monitor should have serpapi-read custom tool', () => {
      const t = getTemplateById('seo-monitor');
      expect(t!.custom_tools).toContain('serpapi-read');
    });

    it('Marketing Analytics Reporter should have posthog-read custom tool', () => {
      const t = getTemplateById('marketing-analytics-reporter');
      expect(t!.custom_tools).toContain('posthog-read');
    });

    it('Customer Feedback Analyst should have zendesk-read || hubspot-read custom tool', () => {
      const t = getTemplateById('customer-feedback-analyst');
      expect(t!.custom_tools).toContain('zendesk-read || hubspot-read');
    });

    it('Content Strategist should use opus model', () => {
      const t = getTemplateById('content-strategist');
      expect(t!.model).toBe('opus');
    });

    it('Social Media Manager should use sonnet model', () => {
      const t = getTemplateById('social-media-manager');
      expect(t!.model).toBe('sonnet');
    });

    it('SEO Monitor should have company-research skill', () => {
      const t = getTemplateById('seo-monitor');
      expect(t!.skills).toContain('company-research');
    });

    it('Brand Monitor should have empty skills', () => {
      const t = getTemplateById('brand-monitor');
      expect(t!.skills).toEqual([]);
    });
  });
});
