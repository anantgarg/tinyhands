import { Router, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger';

const router = Router();

interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  systemPrompt: string;
  tools: string[];
  model: string;
  [key: string]: unknown;
}

// Lightweight YAML frontmatter parser (same approach as skills/builtins)
function parseYamlFrontmatter(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const line of lines) {
    const arrayMatch = line.match(/^\s+-\s+(.*)/);
    if (arrayMatch && currentKey && currentArray) {
      currentArray.push(arrayMatch[1].trim());
      continue;
    }

    if (currentKey && currentArray) {
      result[currentKey] = currentArray;
      currentKey = null;
      currentArray = null;
    }

    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const rawValue = kvMatch[2].trim();

    if (rawValue === '') {
      currentKey = key;
      currentArray = [];
      continue;
    }

    if (rawValue === 'true') { result[key] = true; continue; }
    if (rawValue === 'false') { result[key] = false; continue; }
    if (/^\d+$/.test(rawValue)) { result[key] = parseInt(rawValue, 10); continue; }

    if ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
      result[key] = rawValue.slice(1, -1);
      continue;
    }

    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const inner = rawValue.slice(1, -1).trim();
      result[key] = inner === '' ? [] : inner.split(',').map(s => s.trim());
      continue;
    }

    result[key] = rawValue;
  }

  if (currentKey && currentArray) {
    result[currentKey] = currentArray;
  }

  return result;
}

let cachedTemplates: AgentTemplate[] | null = null;

function loadTemplates(): AgentTemplate[] {
  if (cachedTemplates) return cachedTemplates;

  const templates: AgentTemplate[] = [];
  const templatesDir = path.join(__dirname, '../../../templates');

  if (!fs.existsSync(templatesDir)) {
    cachedTemplates = [];
    return [];
  }

  const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(templatesDir, file), 'utf-8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)/);
      if (!fmMatch) continue;

      const metadata = parseYamlFrontmatter(fmMatch[1]);
      const body = fmMatch[2].trim();

      templates.push({
        id: (metadata.id as string) || file.replace('.md', ''),
        name: (metadata.name as string) || file.replace('.md', ''),
        description: (metadata.description as string) || '',
        category: (metadata.category as string) || 'general',
        systemPrompt: body,
        tools: (metadata.tools as string[]) || [],
        model: (metadata.model as string) || 'sonnet',
        ...metadata,
      });
    } catch (err: any) {
      logger.warn('Failed to load template', { file, error: err.message });
    }
  }

  cachedTemplates = templates;
  return templates;
}

// GET /templates — List agent templates
router.get('/', (_req, res: Response) => {
  try {
    const templates = loadTemplates();
    res.json(templates);
  } catch (err: any) {
    logger.error('List templates error', { error: err.message });
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

// GET /templates/:id — Get a specific template
router.get('/:id', (req, res: Response) => {
  try {
    const templates = loadTemplates();
    const template = templates.find(t => t.id === req.params.id);
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    res.json(template);
  } catch (err: any) {
    logger.error('Get template error', { error: err.message });
    res.status(500).json({ error: 'Failed to get template' });
  }
});

export default router;
