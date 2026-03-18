import { createKBEntry, approveKBEntry, type CreateKBEntryParams } from '../knowledge-base';
import type { KBEntry, KBSourceType } from '../../types';
import { logger } from '../../utils/logger';

// ── KB Ingestion Wizard ──

export interface WizardSuggestions {
  title: string;
  summary: string;
  category: string;
  tags: string[];
}

export interface WizardState {
  step: 'content' | 'metadata' | 'confirm';
  content: string;
  suggestions: WizardSuggestions | null;
  overrides: Partial<WizardSuggestions>;
  sourceType: KBSourceType;
  contributedBy: string | null;
}

export function createWizardState(
  content: string,
  sourceType: KBSourceType,
  contributedBy?: string
): WizardState {
  return {
    step: 'content',
    content,
    suggestions: null,
    overrides: {},
    sourceType,
    contributedBy: contributedBy || null,
  };
}

export function generateSuggestionsHeuristic(content: string): WizardSuggestions {
  const firstLine = content.split('\n')[0] || 'Untitled';
  const title = firstLine.slice(0, 80).trim();

  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const summary = sentences.slice(0, 2).join('. ').trim() + '.';

  const words = content.toLowerCase().split(/\s+/);
  const wordFreq = new Map<string, number>();
  for (const word of words) {
    if (word.length > 4) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }
  }
  const tags = [...wordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  return {
    title,
    summary,
    category: 'General',
    tags,
  };
}

export async function generateSuggestions(content: string): Promise<WizardSuggestions> {
  // Try AI-powered metadata generation, fall back to heuristics
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: `Extract metadata from the provided content. Return ONLY valid JSON with these fields:
{"title": "...", "summary": "...", "category": "...", "tags": ["...", "..."]}
- title: concise title (max 80 chars)
- summary: 1-2 sentence summary
- category: one of: General, Engineering, Product, Support, Sales, HR, Legal, Finance, Operations
- tags: 3-5 relevant keywords`,
      messages: [{
        role: 'user',
        content: content.slice(0, 3000),
      }],
    });

    const text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    const parsed = JSON.parse(text);
    return {
      title: parsed.title || content.split('\n')[0]?.slice(0, 80) || 'Untitled',
      summary: parsed.summary || '',
      category: parsed.category || 'General',
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  } catch (err: any) {
    logger.warn('AI KB metadata generation failed, using heuristics', { error: err.message });
    return generateSuggestionsHeuristic(content);
  }
}

export async function advanceWizard(
  state: WizardState,
  action: 'suggest' | 'confirm' | 'override',
  data?: Partial<WizardSuggestions>
): Promise<WizardState> {
  switch (action) {
    case 'suggest':
      return {
        ...state,
        step: 'metadata',
        suggestions: await generateSuggestions(state.content),
      };

    case 'override':
      return {
        ...state,
        overrides: { ...state.overrides, ...data },
      };

    case 'confirm': {
      const suggestions = state.suggestions || await generateSuggestions(state.content);
      const final = { ...suggestions, ...state.overrides };
      return {
        ...state,
        step: 'confirm',
        suggestions: final,
      };
    }

    default:
      return state;
  }
}

export async function completeWizard(workspaceId: string, state: WizardState): Promise<KBEntry> {
  if (!state.suggestions) {
    throw new Error('Cannot complete wizard without suggestions');
  }

  const params: CreateKBEntryParams = {
    title: state.overrides.title || state.suggestions.title,
    summary: state.overrides.summary || state.suggestions.summary,
    content: state.content,
    category: state.overrides.category || state.suggestions.category,
    tags: state.overrides.tags || state.suggestions.tags,
    accessScope: 'all',
    sourceType: state.sourceType,
    contributedBy: state.contributedBy || undefined,
    approved: state.sourceType === 'manual',
  };

  const entry = await createKBEntry(workspaceId, params);

  logger.info('KB wizard completed', { entryId: entry.id, sourceType: state.sourceType });
  return entry;
}

// ── Agent-Contributed Flow ──

export async function createAgentContribution(
  workspaceId: string,
  agentId: string,
  content: string,
  suggestions: WizardSuggestions
): Promise<KBEntry> {
  return createKBEntry(workspaceId, {
    title: suggestions.title,
    summary: suggestions.summary,
    content,
    category: suggestions.category,
    tags: suggestions.tags,
    accessScope: 'all',
    sourceType: 'agent',
    contributedBy: agentId,
    approved: false,
  });
}

export async function approveContribution(workspaceId: string, entryId: string): Promise<KBEntry> {
  return approveKBEntry(workspaceId, entryId);
}
