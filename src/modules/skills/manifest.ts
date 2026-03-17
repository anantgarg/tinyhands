export interface McpSkillManifest {
  id: string;
  name: string;
  skillType: 'mcp';
  capabilities: string[];
}

export interface PromptSkillManifest {
  id: string;
  name: string;
  skillType: 'prompt_template';
  description: string;
  template: string;
}

export type SkillManifest = McpSkillManifest | PromptSkillManifest;
