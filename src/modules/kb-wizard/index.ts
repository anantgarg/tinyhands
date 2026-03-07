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

export function generateSuggestions(content: string): WizardSuggestions {
  // In production, this calls Claude to generate metadata.
  // Here we provide basic heuristic-based suggestions.
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

export function advanceWizard(
  state: WizardState,
  action: 'suggest' | 'confirm' | 'override',
  data?: Partial<WizardSuggestions>
): WizardState {
  switch (action) {
    case 'suggest':
      return {
        ...state,
        step: 'metadata',
        suggestions: generateSuggestions(state.content),
      };

    case 'override':
      return {
        ...state,
        overrides: { ...state.overrides, ...data },
      };

    case 'confirm': {
      const suggestions = state.suggestions || generateSuggestions(state.content);
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

export function completeWizard(state: WizardState): KBEntry {
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

  const entry = createKBEntry(params);

  logger.info('KB wizard completed', { entryId: entry.id, sourceType: state.sourceType });
  return entry;
}

// ── Agent-Contributed Flow ──

export function createAgentContribution(
  agentId: string,
  content: string,
  suggestions: WizardSuggestions
): KBEntry {
  return createKBEntry({
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

export function approveContribution(entryId: string): KBEntry {
  return approveKBEntry(entryId);
}
