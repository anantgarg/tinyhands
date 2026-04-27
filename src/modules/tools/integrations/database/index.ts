import { registerCustomTool, getCustomTool } from '../../index';
import { config as appConfig } from '../../../../config';
import { logger } from '../../../../utils/logger';
import type { ToolManifest } from '../manifest';

// ── Schemas ──
//
// The Database tool surfaces a workspace's per-schema data to agents through
// two variants: a read-only tool (list/describe/select/aggregate/sql) and a
// read-write tool (insert/update/delete). DDL (create/alter/drop of tables
// or columns) is NEVER exposed — schema changes are admin-only through the
// dashboard. The write variant goes through the standard write-policy
// approval gate by hitting /internal/approval/request before mutating.

const READ_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Query this workspace\'s structured database. Introspect tables and columns, read rows, run aggregates (count/sum/avg/min/max with optional group-by), or run a read-only SELECT. Schema changes are not permitted.',
  properties: {
    action: {
      type: 'string',
      enum: ['list_tables', 'describe_table', 'select', 'aggregate', 'sql'],
      description: 'The database read action to perform.',
    },
    table: { type: 'string', description: 'Table name (required for describe_table, select, aggregate).' },
    columns: { type: 'array', items: { type: 'string' }, description: 'Columns to return (optional, select).' },
    where: { type: 'object', description: 'Equality filters as { column: value } (optional, select / aggregate).' },
    order_by: { type: 'string', description: 'Column to sort by (optional, select).' },
    order_dir: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction (optional, select).' },
    limit: { type: 'number', description: 'Max rows to return (default 100, max 1000).' },
    offset: { type: 'number', description: 'Row offset (optional, select).' },
    fn: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'], description: 'Aggregate function (required for aggregate).' },
    column: { type: 'string', description: 'Column to aggregate over (required for sum/avg/min/max).' },
    group_by: { type: 'string', description: 'Column to group by (optional, aggregate).' },
    query: { type: 'string', description: 'A single read-only SELECT statement (required for sql).' },
  },
  required: ['action'],
});

const WRITE_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Insert, update, or delete rows in this workspace\'s database. Write actions go through the workspace\'s write-approval policy. Schema changes (create/alter/drop of tables and columns) are not permitted here — use the dashboard.',
  properties: {
    action: {
      type: 'string',
      enum: ['insert', 'update', 'delete'],
      description: 'The database write action to perform.',
    },
    table: { type: 'string', description: 'Table name.' },
    values: { type: 'object', description: 'Column → value pairs (required for insert, update).' },
    id: { type: 'number', description: 'Row id (required for update, delete).' },
  },
  required: ['action', 'table'],
});

// ── Shared client code (runs inside the Docker container) ──

const CLIENT_CODE = `var http = require('http');
var fs = require('fs');
var path = require('path');

var configPath = path.join(__dirname, 'CONFIG_FILENAME');
var cfg = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};
var apiUrl = cfg.api_url || 'http://host.docker.internal:3000';
var secret = cfg.internal_secret || '';
var workspaceId = process.env.WORKSPACE_ID || '';
var agentId = process.env.AGENT_ID || '';
var approvalEndpoint = process.env.WRITE_APPROVAL_ENDPOINT || '';
var writePolicy = process.env.WRITE_APPROVAL_POLICY || '';

function httpRequest(method, urlPath, body) {
  return new Promise(function(resolve, reject) {
    var url = new URL(apiUrl + urlPath);
    var options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    };
    if (secret) options.headers['X-Internal-Secret'] = secret;
    if (workspaceId) options.headers['X-Workspace-Id'] = workspaceId;
    var req = http.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, data: data.slice(0, 2000) }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, function() { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function requestApproval(toolName, details) {
  if (!approvalEndpoint || !writePolicy) return 'approved';
  var channelId = process.env.CHANNEL_ID || '';
  var userId = process.env.USER_ID || '';
  var threadTs = process.env.THREAD_TS || '';
  var agentName = process.env.AGENT_NAME || 'Agent';
  var endpoint = approvalEndpoint.replace(/\\/$/, '');
  var resp = await httpRequest('POST', endpoint.replace(apiUrl, '') + '/request', {
    workspaceId: workspaceId,
    agentId: agentId,
    agentName: agentName,
    toolName: toolName,
    details: details,
    userId: userId,
    channelId: channelId,
    threadTs: threadTs,
    writePolicy: writePolicy,
  });
  if (resp.status !== 200 || !resp.data || !resp.data.requestId) return 'approved';
  var requestId = resp.data.requestId;
  var pollStart = Date.now();
  var TIMEOUT_MS = 300000;
  while (Date.now() - pollStart < TIMEOUT_MS) {
    await new Promise(function(r) { setTimeout(r, 3000); });
    var pollResp = await httpRequest('GET', endpoint.replace(apiUrl, '') + '/poll/' + requestId + '?workspaceId=' + encodeURIComponent(workspaceId), null);
    var s = pollResp.data && pollResp.data.status;
    if (s === 'approved' || s === 'denied' || s === 'expired') return s;
  }
  return 'expired';
}

async function main() {
  var action = input.action;
  var result;

  try {
    switch (action) {
      case 'list_tables': {
        var resp = await httpRequest('GET', '/internal/database/tables', null);
        result = resp.data;
        break;
      }
      case 'describe_table': {
        if (!input.table) { result = { error: 'table is required' }; break; }
        var resp = await httpRequest('GET', '/internal/database/tables/' + encodeURIComponent(input.table), null);
        result = resp.data;
        break;
      }
      case 'select': {
        if (!input.table) { result = { error: 'table is required' }; break; }
        var resp = await httpRequest('POST', '/internal/database/select', {
          table: input.table, columns: input.columns, where: input.where,
          order_by: input.order_by, order_dir: input.order_dir,
          limit: input.limit, offset: input.offset,
        });
        result = resp.data;
        break;
      }
      case 'aggregate': {
        if (!input.table || !input.fn) { result = { error: 'table and fn are required' }; break; }
        var resp = await httpRequest('POST', '/internal/database/aggregate', {
          table: input.table, fn: input.fn, column: input.column,
          group_by: input.group_by, where: input.where, limit: input.limit,
        });
        result = resp.data;
        break;
      }
      case 'sql': {
        if (!input.query) { result = { error: 'query is required' }; break; }
        var resp = await httpRequest('POST', '/internal/database/sql', { query: input.query });
        result = resp.data;
        break;
      }
      case 'insert':
      case 'update':
      case 'delete': {
        if (!input.table) { result = { error: 'table is required' }; break; }
        var details = action + ' on ' + input.table + (input.id ? (' (id=' + input.id + ')') : '');
        var approved = await requestApproval('database-write.' + action, details);
        if (approved !== 'approved') { result = { error: 'Write ' + approved + ' by user' }; break; }
        var resp = await httpRequest('POST', '/internal/database/' + action, {
          table: input.table, values: input.values, id: input.id,
        });
        result = resp.data;
        break;
      }
      default:
        result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  console.log(JSON.stringify(result));
}

main().catch(function(err) { console.log(JSON.stringify({ error: err.message })); });
`;

const READ_CODE = CLIENT_CODE.replace('CONFIG_FILENAME', 'database-read.config.json');
const WRITE_CODE = CLIENT_CODE.replace('CONFIG_FILENAME', 'database-write.config.json');

export const manifest: ToolManifest = {
  id: 'database',
  label: 'Database',
  icon: ':file_cabinet:',
  description: 'Query and mutate the workspace\'s structured database. No API keys needed — tables are managed in the dashboard.',
  configKeys: [],
  supportedCredentialModes: [],
  autoConfigured: true,
  tools: [
    { name: 'database-read', schema: READ_SCHEMA, code: READ_CODE, accessLevel: 'read-only', displayName: 'Querying database' },
    { name: 'database-write', schema: WRITE_SCHEMA, code: WRITE_CODE, accessLevel: 'read-write', displayName: 'Updating database' },
  ],
  async register(workspaceId, _userId, _config) {
    const toolConfig: Record<string, string> = {
      api_url: `http://host.docker.internal:${appConfig.server.port}`,
    };
    if (appConfig.server.internalSecret) {
      toolConfig.internal_secret = appConfig.server.internalSecret;
    }
    for (const tool of this.tools) {
      const existing = await getCustomTool(workspaceId, tool.name);
      if (existing) continue;
      await registerCustomTool(workspaceId, tool.name, tool.schema, null, 'system', {
        code: tool.code,
        language: 'javascript',
        autoApprove: true,
        accessLevel: tool.accessLevel,
        configJson: JSON.stringify(toolConfig),
      });
      logger.info(`Database tool registered: ${tool.name}`);
    }
  },
  async updateConfig(_workspaceId) {
    // Config is derived from app config, not user-provided.
  },
};
