import * as fs from 'fs';
import * as path from 'path';

export type TemplateCategory = 'Content & SEO' | 'Social Media' | 'Competitive Intelligence' | 'Analytics & Reporting' | 'Customer & Community';

export interface AgentTemplate {
  id: string;
  name: string;
  emoji: string;
  category: TemplateCategory;
  description: string;
  model: 'opus' | 'sonnet' | 'haiku';
  memory_enabled: boolean;
  mentions_only: boolean;
  respond_to_all_messages: boolean;
  max_turns: number;
  tools: string[];
  custom_tools: string[];
  skills: string[];
  relevance_keywords: string[];
  systemPrompt: string;
}

// ── Lightweight YAML parser (simple key-value + arrays only) ──

function parseYamlFrontmatter(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const line of lines) {
    // Array item line (starts with spaces/tabs then "- ")
    const arrayMatch = line.match(/^\s+-\s+(.*)/);
    if (arrayMatch && currentKey && currentArray) {
      currentArray.push(arrayMatch[1].trim());
      continue;
    }

    // If we were collecting an array and this line is not an array item, flush it
    if (currentKey && currentArray) {
      result[currentKey] = currentArray;
      currentKey = null;
      currentArray = null;
    }

    // Key-value line
    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const rawValue = kvMatch[2].trim();

    // If value is empty, this key starts an array
    if (rawValue === '') {
      currentKey = key;
      currentArray = [];
      continue;
    }

    // Boolean
    if (rawValue === 'true') { result[key] = true; continue; }
    if (rawValue === 'false') { result[key] = false; continue; }

    // Number (integers only for our use case)
    if (/^\d+$/.test(rawValue)) { result[key] = parseInt(rawValue, 10); continue; }

    // String — strip surrounding quotes if present
    if ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
      result[key] = rawValue.slice(1, -1);
      continue;
    }

    // Array in bracket notation [a, b, c]
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const inner = rawValue.slice(1, -1).trim();
      if (inner === '') {
        result[key] = [];
      } else {
        result[key] = inner.split(',').map(s => s.trim());
      }
      continue;
    }

    result[key] = rawValue;
  }

  // Flush trailing array
  if (currentKey && currentArray) {
    result[currentKey] = currentArray;
  }

  return result;
}

function parseTemplateFile(content: string): AgentTemplate {
  // Split on frontmatter delimiters
  const parts = content.split('---');
  if (parts.length < 3) {
    throw new Error('Template file must have YAML frontmatter delimited by ---');
  }

  const yamlContent = parts[1];
  const systemPrompt = parts.slice(2).join('---').trim();
  const meta = parseYamlFrontmatter(yamlContent);

  return {
    id: meta.id as string,
    name: meta.name as string,
    emoji: meta.emoji as string,
    category: meta.category as TemplateCategory,
    description: meta.description as string,
    model: meta.model as 'opus' | 'sonnet' | 'haiku',
    memory_enabled: meta.memory_enabled as boolean,
    mentions_only: meta.mentions_only as boolean,
    respond_to_all_messages: meta.respond_to_all_messages as boolean,
    max_turns: meta.max_turns as number,
    tools: (meta.tools as string[]) || [],
    custom_tools: (meta.custom_tools as string[]) || [],
    skills: (meta.skills as string[]) || [],
    relevance_keywords: (meta.relevance_keywords as string[]) || [],
    systemPrompt,
  };
}

// ── Template cache ──

let cachedTemplates: AgentTemplate[] | null = null;

function loadTemplates(): AgentTemplate[] {
  const templatesDir = path.join(__dirname, '../../../templates');
  if (!fs.existsSync(templatesDir)) return [];

  const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.md')).sort();
  const templates: AgentTemplate[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(templatesDir, file), 'utf-8');
    templates.push(parseTemplateFile(content));
  }

  return templates;
}

function getTemplatesCache(): AgentTemplate[] {
  if (!cachedTemplates) {
    cachedTemplates = loadTemplates();
  }
  return cachedTemplates;
}

/**
 * Resolve custom_tools entries, handling "a || b" alternatives.
 * Returns the tools that are available and groups where none were found.
 */
export async function resolveCustomTools(
  customTools: string[],
  toolExists: (name: string) => Promise<boolean>,
): Promise<{ resolvedTools: string[]; missingGroups: string[][] }> {
  if (!customTools || !Array.isArray(customTools) || customTools.length === 0) {
    return { resolvedTools: [], missingGroups: [] };
  }

  const resolvedTools: string[] = [];
  const missingGroups: string[][] = [];

  for (const entry of customTools) {
    const alternatives = entry.split('||').map(s => s.trim()).filter(Boolean);
    const available: string[] = [];
    for (const alt of alternatives) {
      if (await toolExists(alt)) available.push(alt);
    }
    if (available.length > 0) {
      resolvedTools.push(...available);
    } else {
      missingGroups.push(alternatives);
    }
  }

  return { resolvedTools, missingGroups };
}

// ── Public API ──

export function getAllTemplates(): AgentTemplate[] {
  return getTemplatesCache();
}

export function getTemplateById(id: string): AgentTemplate | undefined {
  return getTemplatesCache().find(t => t.id === id);
}

export function getTemplatesByCategory(): Record<TemplateCategory, AgentTemplate[]> {
  const result: Record<TemplateCategory, AgentTemplate[]> = {
    'Content & SEO': [],
    'Social Media': [],
    'Competitive Intelligence': [],
    'Analytics & Reporting': [],
    'Customer & Community': [],
  };

  for (const t of getTemplatesCache()) {
    if (result[t.category]) {
      result[t.category].push(t);
    }
  }

  return result;
}

/** @internal Reset cached templates (for testing only). */
export function _resetCache(): void {
  cachedTemplates = null;
}
