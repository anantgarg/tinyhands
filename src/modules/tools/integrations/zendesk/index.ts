import { registerCustomTool, getCustomTool } from '../../index';
import { execute } from '../../../../db';
import { logger } from '../../../../utils/logger';
import type { ToolManifest } from '../manifest';

// ── Schemas & Code ──

const READ_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Read-only access to Zendesk: search tickets, get ticket details, get users/orgs, ticket metrics, satisfaction ratings, and views.',
  properties: {
    action: {
      type: 'string',
      enum: ['search', 'get_ticket', 'get_ticket_comments', 'get_user', 'get_organization', 'list_views', 'get_view_tickets', 'get_ticket_metrics', 'get_satisfaction_ratings'],
      description: 'The Zendesk action to perform',
    },
    query: { type: 'string', description: 'Search query (for search action). Uses Zendesk search syntax: e.g. "status:open tags:billing created>2024-01-01"' },
    ticket_id: { type: 'number', description: 'Ticket ID (for get_ticket, get_ticket_comments, get_ticket_metrics)' },
    user_id: { type: 'number', description: 'User ID (for get_user)' },
    organization_id: { type: 'number', description: 'Organization ID (for get_organization)' },
    view_id: { type: 'number', description: 'View ID (for get_view_tickets)' },
    page: { type: 'number', description: 'Page number for paginated results (default 1)' },
    per_page: { type: 'number', description: 'Results per page (default 100, max 100)' },
    sort_by: { type: 'string', description: 'Sort field (for search: created_at, updated_at, priority, status, ticket_type)' },
    sort_order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order (default desc)' },
  },
  required: ['action'],
});

const READ_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'zendesk-read.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const subdomain = config.subdomain;
const email = config.email;
const apiToken = config.api_token;

if (!subdomain || !email || !apiToken) {
  console.log(JSON.stringify({ error: 'Zendesk credentials not configured. Admin must set subdomain, email, and api_token in tool config.' }));
  process.exit(0);
}

const auth = Buffer.from(email + '/token:' + apiToken).toString('base64');

function zendeskRequest(path) {
  return new Promise((resolve, reject) => {
    const url = new URL('https://' + subdomain + '.zendesk.com' + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data.slice(0, 2000) });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

async function main() {
  const { action, query, ticket_id, user_id, organization_id, view_id, page, per_page, sort_by, sort_order } = input;
  const pageParam = page || 1;
  const perPageParam = Math.min(per_page || 100, 100);

  let result;

  switch (action) {
    case 'search': {
      if (!query) { result = { error: 'query is required for search' }; break; }
      let path = '/api/v2/search.json?query=' + encodeURIComponent(query) + '&page=' + pageParam + '&per_page=' + perPageParam;
      if (sort_by) path += '&sort_by=' + encodeURIComponent(sort_by);
      if (sort_order) path += '&sort_order=' + encodeURIComponent(sort_order);
      result = await zendeskRequest(path);
      break;
    }
    case 'get_ticket': {
      if (!ticket_id) { result = { error: 'ticket_id is required' }; break; }
      result = await zendeskRequest('/api/v2/tickets/' + ticket_id + '.json');
      break;
    }
    case 'get_ticket_comments': {
      if (!ticket_id) { result = { error: 'ticket_id is required' }; break; }
      result = await zendeskRequest('/api/v2/tickets/' + ticket_id + '/comments.json?page=' + pageParam + '&per_page=' + perPageParam);
      break;
    }
    case 'get_user': {
      if (!user_id) { result = { error: 'user_id is required' }; break; }
      result = await zendeskRequest('/api/v2/users/' + user_id + '.json');
      break;
    }
    case 'get_organization': {
      if (!organization_id) { result = { error: 'organization_id is required' }; break; }
      result = await zendeskRequest('/api/v2/organizations/' + organization_id + '.json');
      break;
    }
    case 'list_views': {
      result = await zendeskRequest('/api/v2/views.json?page=' + pageParam + '&per_page=' + perPageParam);
      break;
    }
    case 'get_view_tickets': {
      if (!view_id) { result = { error: 'view_id is required' }; break; }
      result = await zendeskRequest('/api/v2/views/' + view_id + '/tickets.json?page=' + pageParam + '&per_page=' + perPageParam);
      break;
    }
    case 'get_ticket_metrics': {
      if (!ticket_id) { result = { error: 'ticket_id is required' }; break; }
      result = await zendeskRequest('/api/v2/tickets/' + ticket_id + '/metrics.json');
      break;
    }
    case 'get_satisfaction_ratings': {
      result = await zendeskRequest('/api/v2/satisfaction_ratings.json?page=' + pageParam + '&per_page=' + perPageParam);
      break;
    }
    default:
      result = { error: 'Unknown action: ' + action + '. Valid actions: search, get_ticket, get_ticket_comments, get_user, get_organization, list_views, get_view_tickets, get_ticket_metrics, get_satisfaction_ratings' };
  }

  console.log(JSON.stringify(result));
}

main().catch(err => {
  console.log(JSON.stringify({ error: err.message }));
});`;

const WRITE_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Create and respond to Zendesk tickets. No destructive actions (no delete, no close).',
  properties: {
    action: {
      type: 'string',
      enum: ['create_ticket', 'add_comment', 'update_ticket_tags', 'update_ticket_priority', 'update_ticket_assignee'],
      description: 'The Zendesk write action to perform',
    },
    subject: { type: 'string', description: 'Ticket subject (for create_ticket)' },
    body: { type: 'string', description: 'Ticket body / comment text (for create_ticket, add_comment)' },
    ticket_id: { type: 'number', description: 'Ticket ID (for add_comment, update_ticket_tags, update_ticket_priority, update_ticket_assignee)' },
    requester_email: { type: 'string', description: 'Requester email address (for create_ticket)' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Tags to set on the ticket (for update_ticket_tags)' },
    priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: 'Priority level (for create_ticket, update_ticket_priority)' },
    assignee_id: { type: 'number', description: 'Agent user ID to assign to (for update_ticket_assignee)' },
    public_reply: { type: 'boolean', description: 'Whether the comment is public (true) or internal note (false). Default true.' },
  },
  required: ['action'],
});

const WRITE_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'zendesk-write.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const subdomain = config.subdomain;
const email = config.email;
const apiToken = config.api_token;

if (!subdomain || !email || !apiToken) {
  console.log(JSON.stringify({ error: 'Zendesk credentials not configured. Admin must set subdomain, email, and api_token in tool config.' }));
  process.exit(0);
}

const auth = Buffer.from(email + '/token:' + apiToken).toString('base64');

function zendeskRequest(path, method, body) {
  return new Promise((resolve, reject) => {
    const url = new URL('https://' + subdomain + '.zendesk.com' + path);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method || 'GET',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data.slice(0, 2000) });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const { action, subject, body, ticket_id, requester_email, tags, priority, assignee_id, public_reply } = input;

  let result;

  switch (action) {
    case 'create_ticket': {
      if (!subject || !body) { result = { error: 'subject and body are required for create_ticket' }; break; }
      const ticket = { ticket: { subject, comment: { body }, priority: priority || 'normal' } };
      if (requester_email) ticket.ticket.requester = { email: requester_email };
      result = await zendeskRequest('/api/v2/tickets.json', 'POST', ticket);
      break;
    }
    case 'add_comment': {
      if (!ticket_id || !body) { result = { error: 'ticket_id and body are required for add_comment' }; break; }
      const isPublic = public_reply !== false;
      result = await zendeskRequest('/api/v2/tickets/' + ticket_id + '.json', 'PUT', {
        ticket: { comment: { body, public: isPublic } },
      });
      break;
    }
    case 'update_ticket_tags': {
      if (!ticket_id || !tags) { result = { error: 'ticket_id and tags are required' }; break; }
      result = await zendeskRequest('/api/v2/tickets/' + ticket_id + '.json', 'PUT', {
        ticket: { tags },
      });
      break;
    }
    case 'update_ticket_priority': {
      if (!ticket_id || !priority) { result = { error: 'ticket_id and priority are required' }; break; }
      result = await zendeskRequest('/api/v2/tickets/' + ticket_id + '.json', 'PUT', {
        ticket: { priority },
      });
      break;
    }
    case 'update_ticket_assignee': {
      if (!ticket_id || !assignee_id) { result = { error: 'ticket_id and assignee_id are required' }; break; }
      result = await zendeskRequest('/api/v2/tickets/' + ticket_id + '.json', 'PUT', {
        ticket: { assignee_id },
      });
      break;
    }
    default:
      result = { error: 'Unknown action: ' + action + '. Valid actions: create_ticket, add_comment, update_ticket_tags, update_ticket_priority, update_ticket_assignee' };
  }

  console.log(JSON.stringify(result));
}

main().catch(err => {
  console.log(JSON.stringify({ error: err.message }));
});`;

// ── Manifest ──

export const manifest: ToolManifest = {
  id: 'zendesk',
  label: 'Zendesk',
  icon: ':ticket:',
  description: 'Search tickets, get details, create tickets, add comments, manage tags/priority.',
  configKeys: ['subdomain', 'email', 'api_token'],
  setupGuide: 'How to get your credentials:\n1. Your subdomain is the first part of your-company.zendesk.com\n2. Use the email address of a Zendesk admin account\n3. For the API token: go to Admin Center > Apps and integrations > APIs > Zendesk API\n4. Click "Add API token", give it a description, and copy the token',
  configPlaceholders: {
    subdomain: 'your-company',
    email: 'admin@company.com',
    api_token: 'API token from Admin Center',
  },
  tools: [
    { name: 'zendesk-read', schema: READ_SCHEMA, code: READ_CODE, accessLevel: 'read-only', displayName: 'Checking Zendesk' },
    { name: 'zendesk-write', schema: WRITE_SCHEMA, code: WRITE_CODE, accessLevel: 'read-write', displayName: 'Updating Zendesk' },
  ],
  async register(workspaceId, userId, config) {
    const configJson = JSON.stringify(config);
    for (const tool of this.tools) {
      const existing = await getCustomTool(workspaceId, tool.name);
      if (!existing) {
        await registerCustomTool(workspaceId, tool.name, tool.schema, null, userId, {
          code: tool.code, language: 'javascript', autoApprove: true, accessLevel: tool.accessLevel, configJson,
        });
        logger.info(`${this.label} tool registered: ${tool.name}`);
      }
    }
  },
  async updateConfig(workspaceId, config) {
    const configJson = JSON.stringify(config);
    const names = this.tools.map(t => t.name);
    await execute(`UPDATE custom_tools SET config_json = $1 WHERE workspace_id = $2 AND name = ANY($3)`, [configJson, workspaceId, names]);
    logger.info(`${this.label} config updated`);
  },
};
