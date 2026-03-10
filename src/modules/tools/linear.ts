/**
 * Linear tool registration — read + write tools for Linear issue tracking.
 *
 * Usage:
 *   registerLinearTools('ADMIN_USER_ID', { api_key: 'lin_api_...' })
 */
import { registerCustomTool, getCustomTool } from './index';
import { execute } from '../../db';
import { logger } from '../../utils/logger';

// ── Linear Read-Only Tool ──

const LINEAR_READ_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Read-only access to Linear: search issues, get issue details, list projects, teams, cycles, labels, and users.',
  properties: {
    action: {
      type: 'string',
      enum: ['search_issues', 'get_issue', 'list_projects', 'list_teams', 'get_cycles', 'get_labels', 'get_user'],
      description: 'The Linear action to perform',
    },
    query: {
      type: 'string',
      description: 'Search query text (for search_issues)',
    },
    issue_id: {
      type: 'string',
      description: 'Issue ID like "ENG-123" or UUID (for get_issue)',
    },
    team_id: {
      type: 'string',
      description: 'Team ID (for filtering list_projects, get_cycles, get_labels)',
    },
    user_id: {
      type: 'string',
      description: 'User ID (for get_user)',
    },
    status: {
      type: 'string',
      description: 'Filter by status name (for search_issues), e.g. "In Progress", "Done"',
    },
    limit: {
      type: 'number',
      description: 'Max results (default 25, max 50)',
    },
  },
  required: ['action'],
});

const LINEAR_READ_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join('/tools', 'linear-read.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const apiKey = config.api_key;
if (!apiKey) {
  console.log(JSON.stringify({ error: 'Linear API key not configured. Admin must set api_key in tool config.' }));
  process.exit(0);
}

function linearRequest(query, variables) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ query, variables });
    const options = {
      hostname: 'api.linear.app',
      path: '/graphql',
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ error: data.slice(0, 2000) });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(payload);
    req.end();
  });
}

async function main() {
  const { action, query, issue_id, team_id, user_id, status, limit } = input;
  const lim = Math.min(limit || 25, 50);
  let result;

  switch (action) {
    case 'search_issues': {
      if (!query) { result = { error: 'query is required for search_issues' }; break; }
      let filter = '';
      if (status) filter = ', filter: { state: { name: { eq: "' + status.replace(/"/g, '') + '" } } }';
      const gql = '{ issueSearch(query: "' + query.replace(/"/g, '\\\\"') + '", first: ' + lim + filter + ') { nodes { id identifier title state { name } priority assignee { name } createdAt updatedAt } } }';
      result = await linearRequest(gql);
      break;
    }
    case 'get_issue': {
      if (!issue_id) { result = { error: 'issue_id is required' }; break; }
      const gql = '{ issue(id: "' + issue_id.replace(/"/g, '') + '") { id identifier title description state { name } priority priorityLabel assignee { id name } labels { nodes { name } } project { name } cycle { name number } createdAt updatedAt } }';
      result = await linearRequest(gql);
      break;
    }
    case 'list_projects': {
      let filter = '';
      if (team_id) filter = ', filter: { accessibleTeams: { id: { eq: "' + team_id.replace(/"/g, '') + '" } } }';
      const gql = '{ projects(first: ' + lim + filter + ') { nodes { id name description state startDate targetDate teams { nodes { name } } } } }';
      result = await linearRequest(gql);
      break;
    }
    case 'list_teams': {
      const gql = '{ teams(first: 50) { nodes { id name key description } } }';
      result = await linearRequest(gql);
      break;
    }
    case 'get_cycles': {
      if (!team_id) { result = { error: 'team_id is required for get_cycles' }; break; }
      const gql = '{ team(id: "' + team_id.replace(/"/g, '') + '") { cycles(first: ' + lim + ') { nodes { id name number startsAt endsAt completedAt progress { completedScopeCount totalScopeCount } } } } }';
      result = await linearRequest(gql);
      break;
    }
    case 'get_labels': {
      let filter = team_id ? '(filter: { team: { id: { eq: "' + team_id.replace(/"/g, '') + '" } } }, first: 100)' : '(first: 100)';
      const gql = '{ issueLabels' + filter + ' { nodes { id name color } } }';
      result = await linearRequest(gql);
      break;
    }
    case 'get_user': {
      if (!user_id) { result = { error: 'user_id is required' }; break; }
      const gql = '{ user(id: "' + user_id.replace(/"/g, '') + '") { id name displayName email admin active } }';
      result = await linearRequest(gql);
      break;
    }
    default:
      result = { error: 'Unknown action: ' + action + '. Valid: search_issues, get_issue, list_projects, list_teams, get_cycles, get_labels, get_user' };
  }

  console.log(JSON.stringify(result));
}

main().catch(err => {
  console.log(JSON.stringify({ error: err.message }));
});`;

// ── Linear Read-Write Tool ──

const LINEAR_WRITE_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Create and update Linear issues, add comments, create projects. No destructive actions (no delete).',
  properties: {
    action: {
      type: 'string',
      enum: ['create_issue', 'update_issue', 'add_comment', 'create_project'],
      description: 'The Linear write action to perform',
    },
    title: {
      type: 'string',
      description: 'Issue or project title (for create_issue, create_project)',
    },
    description: {
      type: 'string',
      description: 'Issue or project description (for create_issue, create_project)',
    },
    team_id: {
      type: 'string',
      description: 'Team ID (required for create_issue, create_project)',
    },
    issue_id: {
      type: 'string',
      description: 'Issue ID (for update_issue, add_comment)',
    },
    state_id: {
      type: 'string',
      description: 'State/status ID (for update_issue)',
    },
    priority: {
      type: 'number',
      description: 'Priority 0-4: 0=none, 1=urgent, 2=high, 3=medium, 4=low',
    },
    assignee_id: {
      type: 'string',
      description: 'User ID to assign (for create_issue, update_issue)',
    },
    label_ids: {
      type: 'array',
      items: { type: 'string' },
      description: 'Label IDs to apply',
    },
    project_id: {
      type: 'string',
      description: 'Project ID to link to (for create_issue)',
    },
    cycle_id: {
      type: 'string',
      description: 'Cycle ID to add to (for create_issue)',
    },
    body: {
      type: 'string',
      description: 'Comment body text (for add_comment)',
    },
  },
  required: ['action'],
});

const LINEAR_WRITE_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join('/tools', 'linear-write.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const apiKey = config.api_key;
if (!apiKey) {
  console.log(JSON.stringify({ error: 'Linear API key not configured. Admin must set api_key in tool config.' }));
  process.exit(0);
}

function linearRequest(query, variables) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ query, variables });
    const options = {
      hostname: 'api.linear.app',
      path: '/graphql',
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ error: data.slice(0, 2000) });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(payload);
    req.end();
  });
}

async function main() {
  const { action, title, description, team_id, issue_id, state_id, priority, assignee_id, label_ids, project_id, cycle_id, body } = input;
  let result;

  switch (action) {
    case 'create_issue': {
      if (!title || !team_id) { result = { error: 'title and team_id are required for create_issue' }; break; }
      const fields = ['teamId: "' + team_id.replace(/"/g, '') + '"', 'title: "' + title.replace(/"/g, '\\\\"') + '"'];
      if (description) fields.push('description: "' + description.replace(/"/g, '\\\\"').replace(/\\n/g, '\\\\n') + '"');
      if (priority !== undefined) fields.push('priority: ' + priority);
      if (assignee_id) fields.push('assigneeId: "' + assignee_id.replace(/"/g, '') + '"');
      if (project_id) fields.push('projectId: "' + project_id.replace(/"/g, '') + '"');
      if (cycle_id) fields.push('cycleId: "' + cycle_id.replace(/"/g, '') + '"');
      if (label_ids && label_ids.length > 0) fields.push('labelIds: [' + label_ids.map(function(id) { return '"' + id.replace(/"/g, '') + '"'; }).join(',') + ']');
      const gql = 'mutation { issueCreate(input: { ' + fields.join(', ') + ' }) { success issue { id identifier title url } } }';
      result = await linearRequest(gql);
      break;
    }
    case 'update_issue': {
      if (!issue_id) { result = { error: 'issue_id is required for update_issue' }; break; }
      const fields = [];
      if (state_id) fields.push('stateId: "' + state_id.replace(/"/g, '') + '"');
      if (priority !== undefined) fields.push('priority: ' + priority);
      if (assignee_id) fields.push('assigneeId: "' + assignee_id.replace(/"/g, '') + '"');
      if (title) fields.push('title: "' + title.replace(/"/g, '\\\\"') + '"');
      if (description) fields.push('description: "' + description.replace(/"/g, '\\\\"').replace(/\\n/g, '\\\\n') + '"');
      if (label_ids && label_ids.length > 0) fields.push('labelIds: [' + label_ids.map(function(id) { return '"' + id.replace(/"/g, '') + '"'; }).join(',') + ']');
      if (fields.length === 0) { result = { error: 'No fields to update' }; break; }
      const gql = 'mutation { issueUpdate(id: "' + issue_id.replace(/"/g, '') + '", input: { ' + fields.join(', ') + ' }) { success issue { id identifier title state { name } } } }';
      result = await linearRequest(gql);
      break;
    }
    case 'add_comment': {
      if (!issue_id || !body) { result = { error: 'issue_id and body are required for add_comment' }; break; }
      const gql = 'mutation { commentCreate(input: { issueId: "' + issue_id.replace(/"/g, '') + '", body: "' + body.replace(/"/g, '\\\\"').replace(/\\n/g, '\\\\n') + '" }) { success comment { id body createdAt } } }';
      result = await linearRequest(gql);
      break;
    }
    case 'create_project': {
      if (!title) { result = { error: 'title is required for create_project' }; break; }
      const fields = ['name: "' + title.replace(/"/g, '\\\\"') + '"'];
      if (description) fields.push('description: "' + description.replace(/"/g, '\\\\"').replace(/\\n/g, '\\\\n') + '"');
      if (team_id) fields.push('teamIds: ["' + team_id.replace(/"/g, '') + '"]');
      const gql = 'mutation { projectCreate(input: { ' + fields.join(', ') + ' }) { success project { id name url } } }';
      result = await linearRequest(gql);
      break;
    }
    default:
      result = { error: 'Unknown action: ' + action + '. Valid: create_issue, update_issue, add_comment, create_project' };
  }

  console.log(JSON.stringify(result));
}

main().catch(err => {
  console.log(JSON.stringify({ error: err.message }));
});`;

// ── Registration ──

export async function registerLinearTools(
  adminUserId: string,
  linearConfig: { api_key: string },
): Promise<void> {
  const configJson = JSON.stringify(linearConfig);

  const existingRead = await getCustomTool('linear-read');
  if (!existingRead) {
    await registerCustomTool('linear-read', LINEAR_READ_SCHEMA, null, adminUserId, {
      code: LINEAR_READ_CODE,
      language: 'javascript',
      autoApprove: true,
      accessLevel: 'read-only',
      configJson,
    });
    logger.info('Linear read-only tool registered');
  } else {
    logger.info('Linear read-only tool already exists, skipping');
  }

  const existingWrite = await getCustomTool('linear-write');
  if (!existingWrite) {
    await registerCustomTool('linear-write', LINEAR_WRITE_SCHEMA, null, adminUserId, {
      code: LINEAR_WRITE_CODE,
      language: 'javascript',
      autoApprove: true,
      accessLevel: 'read-write',
      configJson,
    });
    logger.info('Linear read-write tool registered');
  } else {
    logger.info('Linear read-write tool already exists, skipping');
  }
}

export async function updateLinearConfig(
  linearConfig: { api_key: string },
): Promise<void> {
  const configJson = JSON.stringify(linearConfig);
  await execute(`UPDATE custom_tools SET config_json = $1 WHERE name IN ('linear-read', 'linear-write')`, [configJson]);
  logger.info('Linear config updated for both tools');
}
