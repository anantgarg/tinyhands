import * as fs from 'fs';
import * as path from 'path';
import type { SkillManifest, McpSkillManifest, PromptSkillManifest } from '../manifest';

let cachedManifests: SkillManifest[] | null = null;

// Lightweight YAML parser — same approach as templates module
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

function parseSkillFile(content: string): SkillManifest {
  const parts = content.split('---');
  if (parts.length < 3) {
    throw new Error('Skill file must have YAML frontmatter delimited by ---');
  }

  const meta = parseYamlFrontmatter(parts[1]);
  const body = parts.slice(2).join('---').trim();

  if (meta.skillType === 'mcp') {
    return {
      id: meta.id as string,
      name: meta.name as string,
      skillType: 'mcp',
      capabilities: (meta.capabilities as string[]) || [],
    } as McpSkillManifest;
  }

  return {
    id: meta.id as string,
    name: meta.name as string,
    skillType: 'prompt_template',
    description: meta.description as string,
    template: body,
  } as PromptSkillManifest;
}

function loadBuiltinSkills(): SkillManifest[] {
  // Skills directory is at the repo root: /skills/
  const skillsDir = path.join(__dirname, '../../../../skills');
  if (!fs.existsSync(skillsDir)) return [];

  const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md')).sort();
  const manifests: SkillManifest[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(skillsDir, file), 'utf-8');
      manifests.push(parseSkillFile(content));
    } catch { /* skip malformed skill files */ }
  }

  return manifests;
}

export function getBuiltinSkills(): SkillManifest[] {
  if (!cachedManifests) {
    cachedManifests = loadBuiltinSkills();
  }
  return cachedManifests;
}
