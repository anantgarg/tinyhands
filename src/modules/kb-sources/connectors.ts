/**
 * KB Source Connector definitions — setup instructions, required keys, and provider metadata.
 */
import type { KBConnectorType, KBProviderType } from '../../types';

export interface ConnectorDef {
  type: KBConnectorType;
  label: string;
  icon: string;
  provider: KBProviderType;
  description: string;
  requiredKeys: string[];
  setupSteps: string[];
  configFields: Array<{ key: string; label: string; placeholder: string; optional?: boolean }>;
}

export const CONNECTORS: Record<KBConnectorType, ConnectorDef> = {
  google_drive: {
    type: 'google_drive',
    label: 'Google Drive',
    icon: ':file_folder:',
    provider: 'google',
    description: 'Import docs, sheets, PDFs, and files from Google Drive folders. PDFs and images are automatically OCR-processed.',
    requiredKeys: ['client_id', 'client_secret', 'refresh_token'],
    setupSteps: [
      '1. Go to https://console.cloud.google.com/apis/credentials',
      '2. Create a new project (or select existing)',
      '3. Enable the *Google Drive API* under APIs & Services > Library',
      '4. Go to *Credentials* > Create Credentials > *OAuth 2.0 Client ID*',
      '5. Set application type to *Web application*',
      '6. Add `https://developers.google.com/oauthplayground` as an authorized redirect URI',
      '7. Copy the *Client ID* and *Client Secret*',
      '8. Go to https://developers.google.com/oauthplayground',
      '9. Click the gear icon, check "Use your own OAuth credentials", paste your Client ID & Secret',
      '10. In Step 1, select `https://www.googleapis.com/auth/drive.readonly` and authorize',
      '11. In Step 2, click "Exchange authorization code for tokens"',
      '12. Copy the *Refresh Token* from Step 2',
    ],
    configFields: [
      { key: 'folder_id', label: 'Folder ID', placeholder: 'e.g. 1a2b3c4d5e (from the folder URL)' },
      { key: 'file_types', label: 'File types (comma-separated)', placeholder: 'e.g. doc,pdf,sheet', optional: true },
    ],
  },

  zendesk_help_center: {
    type: 'zendesk_help_center',
    label: 'Zendesk Help Center',
    icon: ':ticket:',
    provider: 'zendesk',
    description: 'Import articles from your Zendesk Help Center.',
    requiredKeys: ['subdomain', 'email', 'api_token'],
    setupSteps: [
      '1. Go to Zendesk Admin Center > Apps and integrations > APIs > Zendesk API',
      '2. Enable *Token Access*',
      '3. Click *Add API token*, give it a label like "TinyJobs KB"',
      '4. Copy the generated API token (you won\'t be able to see it again)',
      '5. Your *subdomain* is the part before `.zendesk.com` in your URL',
      '6. Your *email* is the admin email address associated with the token',
    ],
    configFields: [
      { key: 'category_id', label: 'Category ID (optional)', placeholder: 'Leave blank for all articles', optional: true },
      { key: 'locale', label: 'Locale', placeholder: 'e.g. en-us', optional: true },
    ],
  },

  website: {
    type: 'website',
    label: 'Website',
    icon: ':globe_with_meridians:',
    provider: 'firecrawl',
    description: 'Scrape and import content from any website or documentation site.',
    requiredKeys: ['api_key'],
    setupSteps: [
      '1. Go to https://firecrawl.dev and sign up / log in',
      '2. Navigate to your Dashboard > API Keys',
      '3. Create a new API key',
      '4. Copy the API key',
    ],
    configFields: [
      { key: 'url', label: 'Website URL', placeholder: 'e.g. https://docs.example.com' },
      { key: 'max_pages', label: 'Max pages to scrape', placeholder: 'e.g. 100', optional: true },
      { key: 'include_paths', label: 'Include paths (comma-separated)', placeholder: 'e.g. /docs,/blog', optional: true },
      { key: 'exclude_paths', label: 'Exclude paths (comma-separated)', placeholder: 'e.g. /api,/changelog', optional: true },
    ],
  },

  github: {
    type: 'github',
    label: 'GitHub',
    icon: ':computer:',
    provider: 'github',
    description: 'Import docs, READMEs, Mintlify projects, or source code from GitHub repos.',
    requiredKeys: ['token'],
    setupSteps: [
      '1. Go to https://github.com/settings/tokens > *Fine-grained tokens* (recommended)',
      '2. Click "Generate new token"',
      '3. Give it a name like "TinyJobs KB"',
      '4. Set repository access to *Only select repositories* and pick the repos you need',
      '5. Under Permissions > Repository permissions, grant *Contents: Read-only*',
      '6. Click *Generate token* and copy it',
    ],
    configFields: [
      { key: 'repo', label: 'Repository', placeholder: 'e.g. owner/repo-name' },
      { key: 'branch', label: 'Branch', placeholder: 'e.g. main', optional: true },
      { key: 'paths', label: 'Paths (comma-separated)', placeholder: 'e.g. docs/,README.md,src/', optional: true },
      { key: 'content_type', label: 'Content type', placeholder: 'docs | mintlify | source_code', optional: true },
    ],
  },

  hubspot_kb: {
    type: 'hubspot_kb',
    label: 'HubSpot Knowledge Base',
    icon: ':orange_book:',
    provider: 'hubspot',
    description: 'Import knowledge base articles from HubSpot CMS.',
    requiredKeys: ['access_token'],
    setupSteps: [
      '1. Go to HubSpot > Settings > Integrations > Private Apps',
      '2. Click *Create a private app*',
      '3. Give it a name like "TinyJobs KB"',
      '4. Under *Scopes*, add: `cms.knowledge_base.articles.read`',
      '5. Click *Create app*, then *Continue creating*',
      '6. Copy the *Access Token* shown',
    ],
    configFields: [
      { key: 'portal_id', label: 'Portal ID', placeholder: 'e.g. 12345678' },
      { key: 'state', label: 'Article state filter', placeholder: 'PUBLISHED (default)', optional: true },
    ],
  },

  linear_docs: {
    type: 'linear_docs',
    label: 'Linear Docs',
    icon: ':pencil2:',
    provider: 'linear',
    description: 'Import project documents and issue descriptions from Linear.',
    requiredKeys: ['api_key'],
    setupSteps: [
      '1. Go to Linear > Settings > API > *Personal API keys*',
      '2. Click *Create key*',
      '3. Give it a label like "TinyJobs KB"',
      '4. Copy the generated API key',
    ],
    configFields: [
      { key: 'team_key', label: 'Team key (optional)', placeholder: 'e.g. ENG', optional: true },
      { key: 'include_issues', label: 'Include issues', placeholder: 'true or false', optional: true },
      { key: 'include_projects', label: 'Include project docs', placeholder: 'true (default)', optional: true },
    ],
  },
};

export function getConnector(type: KBConnectorType): ConnectorDef {
  return CONNECTORS[type];
}

export function getProviderForConnector(type: KBConnectorType): KBProviderType {
  return CONNECTORS[type].provider;
}

export function listConnectors(): ConnectorDef[] {
  return Object.values(CONNECTORS);
}
