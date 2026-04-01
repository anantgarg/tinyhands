import { registerCustomTool, getCustomTool } from '../../index';
import { config as appConfig } from '../../../../config';
import { logger } from '../../../../utils/logger';
import type { ToolManifest } from '../manifest';

// ── Schemas ──

const READ_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Read, search, and list documents, spreadsheets, and files. Use this to find and read existing documents.',
  properties: {
    action: {
      type: 'string',
      enum: ['list', 'search', 'read_doc', 'read_sheet_tab', 'read_file'],
      description: 'Action to perform',
    },
    document_id: { type: 'string', description: 'Document ID (required for read_doc, read_sheet_tab, read_file)' },
    tab_id: { type: 'string', description: 'Sheet tab ID (required for read_sheet_tab)' },
    query: { type: 'string', description: 'Search query (required for search)' },
    type: { type: 'string', enum: ['doc', 'sheet', 'file'], description: 'Filter by type (optional, for list)' },
    limit: { type: 'number', description: 'Max results (default 10)' },
  },
  required: ['action'],
});

const WRITE_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Create and modify documents, spreadsheets, and files. Create new docs with markdown content, sheets with CSV data, or update existing ones.',
  properties: {
    action: {
      type: 'string',
      enum: ['create_doc', 'create_sheet', 'create_file', 'update_doc', 'update_cells', 'append_rows', 'create_tab', 'delete_tab', 'rename', 'archive'],
      description: 'Action to perform',
    },
    title: { type: 'string', description: 'Document title (for create/rename)' },
    content: { type: 'string', description: 'Markdown content for docs, or base64 content for files' },
    document_id: { type: 'string', description: 'Document ID (for update/rename/archive)' },
    tab_id: { type: 'string', description: 'Sheet tab ID (for update_cells, append_rows, delete_tab)' },
    tab_name: { type: 'string', description: 'Tab name (for create_tab)' },
    cells: {
      type: 'object',
      description: 'Cell updates as {"A1": "value", "B2": 123}. Values can be strings, numbers, or formulas starting with =',
    },
    rows: {
      type: 'array',
      description: 'Rows to append, each row is an array of cell values',
      items: { type: 'array', items: {} },
    },
    csv: { type: 'string', description: 'CSV data to populate a new sheet' },
    mime_type: { type: 'string', description: 'MIME type for file creation' },
    description: { type: 'string', description: 'Optional document description' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
  },
  required: ['action'],
});

// ── Tool Code (runs in Docker container, Node.js built-ins only) ──

const READ_CODE = `var http = require('http');
var fs = require('fs');
var path = require('path');

var configPath = path.join(__dirname, 'docs-read.config.json');
var cfg = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

var apiUrl = cfg.api_url || 'http://host.docker.internal:3000';
var secret = cfg.internal_secret || '';

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
    var req = http.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, data: data.slice(0, 5000) }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, function() { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  var action = input.action;
  var result;

  switch (action) {
    case 'list': {
      var qs = '?limit=' + (input.limit || 10);
      if (input.type) qs += '&type=' + input.type;
      if (process.env.AGENT_ID) qs += '&agent_id=' + process.env.AGENT_ID;
      var resp = await httpRequest('GET', '/internal/docs/list' + qs, null);
      result = resp.status === 200 ? resp.data : { error: 'List failed: HTTP ' + resp.status };
      break;
    }
    case 'search': {
      if (!input.query) { result = { error: 'query is required for search' }; break; }
      var resp = await httpRequest('POST', '/internal/docs/search', { query: input.query, limit: input.limit || 10 });
      result = resp.status === 200 ? resp.data : { error: 'Search failed: HTTP ' + resp.status };
      break;
    }
    case 'read_doc':
    case 'read_file': {
      if (!input.document_id) { result = { error: 'document_id is required' }; break; }
      var resp = await httpRequest('GET', '/internal/docs/get/' + input.document_id, null);
      result = resp.status === 200 ? resp.data : { error: 'Read failed: HTTP ' + resp.status };
      break;
    }
    case 'read_sheet_tab': {
      if (!input.document_id) { result = { error: 'document_id is required' }; break; }
      if (!input.tab_id) {
        var resp = await httpRequest('GET', '/internal/docs/get/' + input.document_id, null);
        result = resp.status === 200 ? resp.data : { error: 'Read failed: HTTP ' + resp.status };
      } else {
        var resp = await httpRequest('GET', '/internal/docs/sheet/' + input.document_id + '/tab/' + input.tab_id, null);
        result = resp.status === 200 ? resp.data : { error: 'Read tab failed: HTTP ' + resp.status };
      }
      break;
    }
    default:
      result = { error: 'Unknown action: ' + action };
  }
  console.log(JSON.stringify(result));
}
main().catch(function(err) { console.log(JSON.stringify({ error: err.message })); });`;

const WRITE_CODE = `var http = require('http');
var fs = require('fs');
var path = require('path');

var configPath = path.join(__dirname, 'docs-write.config.json');
var cfg = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

var apiUrl = cfg.api_url || 'http://host.docker.internal:3000';
var secret = cfg.internal_secret || '';
var agentId = process.env.AGENT_ID || cfg.agent_id || '';
var runId = process.env.RUN_ID || cfg.run_id || '';

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
    var req = http.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, data: data.slice(0, 5000) }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, function() { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  var action = input.action;
  var result;

  switch (action) {
    case 'create_doc': {
      if (!input.title) { result = { error: 'title is required' }; break; }
      var resp = await httpRequest('POST', '/internal/docs/create', {
        type: 'doc', title: input.title, content: input.content || '',
        description: input.description, tags: input.tags,
        agent_id: agentId, run_id: runId,
      });
      result = resp.status === 200 ? { message: 'Document created', id: resp.data.id, title: resp.data.title } : { error: 'Create failed: ' + (resp.data.error || 'HTTP ' + resp.status) };
      break;
    }
    case 'create_sheet': {
      if (!input.title) { result = { error: 'title is required' }; break; }
      var resp = await httpRequest('POST', '/internal/docs/create', {
        type: 'sheet', title: input.title,
        description: input.description, tags: input.tags,
        agent_id: agentId, run_id: runId,
      });
      if (resp.status === 200 && input.csv) {
        // If CSV provided, read the auto-created tab and populate it
        var getResp = await httpRequest('GET', '/internal/docs/get/' + resp.data.id, null);
        if (getResp.status === 200 && getResp.data.tabs && getResp.data.tabs.length > 0) {
          // Parse CSV into cells
          var lines = input.csv.split('\\n');
          var cells = {};
          for (var r = 0; r < lines.length; r++) {
            var cols = lines[r].split(',');
            for (var c = 0; c < cols.length; c++) {
              var letter = '';
              var n = c;
              while (n >= 0) { letter = String.fromCharCode((n % 26) + 65) + letter; n = Math.floor(n / 26) - 1; }
              var val = cols[c].trim();
              var numVal = Number(val);
              cells[letter + (r + 1)] = { v: (!isNaN(numVal) && val !== '') ? numVal : val };
            }
          }
          await httpRequest('POST', '/internal/docs/sheet/' + resp.data.id + '/cells', { tab_id: getResp.data.tabs[0].id, cells: cells });
        }
      }
      result = resp.status === 200 ? { message: 'Sheet created', id: resp.data.id, title: resp.data.title } : { error: 'Create failed: ' + (resp.data.error || 'HTTP ' + resp.status) };
      break;
    }
    case 'create_file': {
      if (!input.title) { result = { error: 'title is required' }; break; }
      var resp = await httpRequest('POST', '/internal/docs/create', {
        type: 'file', title: input.title,
        description: input.description, tags: input.tags,
        agent_id: agentId, run_id: runId,
      });
      result = resp.status === 200 ? { message: 'File created', id: resp.data.id } : { error: 'Create failed: ' + (resp.data.error || 'HTTP ' + resp.status) };
      break;
    }
    case 'update_doc': {
      if (!input.document_id) { result = { error: 'document_id is required' }; break; }
      var body = { agent_id: agentId };
      if (input.content) body.content = input.content;
      if (input.title) body.title = input.title;
      var resp = await httpRequest('POST', '/internal/docs/update/' + input.document_id, body);
      result = resp.status === 200 ? { message: 'Document updated', id: resp.data.id } : { error: 'Update failed: ' + (resp.data.error || 'HTTP ' + resp.status) };
      break;
    }
    case 'update_cells': {
      if (!input.document_id || !input.tab_id) { result = { error: 'document_id and tab_id are required' }; break; }
      // Convert simple values to cell data format
      var cells = {};
      for (var key in (input.cells || {})) {
        var val = input.cells[key];
        if (typeof val === 'string' && val.startsWith('=')) {
          cells[key] = { v: val, f: val };
        } else {
          cells[key] = { v: val };
        }
      }
      var resp = await httpRequest('POST', '/internal/docs/sheet/' + input.document_id + '/cells', { tab_id: input.tab_id, cells: cells });
      result = resp.status === 200 ? { message: 'Cells updated', row_count: resp.data.row_count, col_count: resp.data.col_count } : { error: 'Update failed: ' + (resp.data.error || 'HTTP ' + resp.status) };
      break;
    }
    case 'append_rows': {
      if (!input.document_id || !input.tab_id) { result = { error: 'document_id and tab_id are required' }; break; }
      var resp = await httpRequest('POST', '/internal/docs/sheet/' + input.document_id + '/rows', { tab_id: input.tab_id, rows: input.rows });
      result = resp.status === 200 ? { message: 'Rows appended', row_count: resp.data.row_count } : { error: 'Append failed: ' + (resp.data.error || 'HTTP ' + resp.status) };
      break;
    }
    case 'create_tab': {
      if (!input.document_id) { result = { error: 'document_id is required' }; break; }
      var resp = await httpRequest('POST', '/internal/docs/sheet/' + input.document_id + '/tab', { name: input.tab_name || 'New Sheet' });
      result = resp.status === 200 ? { message: 'Tab created', tab_id: resp.data.id, name: resp.data.name } : { error: 'Create tab failed: ' + (resp.data.error || 'HTTP ' + resp.status) };
      break;
    }
    case 'delete_tab': {
      // Not implemented via internal API yet — would need a DELETE endpoint
      result = { error: 'delete_tab not yet supported via agent tool' };
      break;
    }
    case 'rename': {
      if (!input.document_id || !input.title) { result = { error: 'document_id and title are required' }; break; }
      var resp = await httpRequest('POST', '/internal/docs/update/' + input.document_id, { title: input.title, agent_id: agentId });
      result = resp.status === 200 ? { message: 'Renamed to: ' + input.title } : { error: 'Rename failed: ' + (resp.data.error || 'HTTP ' + resp.status) };
      break;
    }
    case 'archive': {
      if (!input.document_id) { result = { error: 'document_id is required' }; break; }
      var resp = await httpRequest('DELETE', '/internal/docs/delete/' + input.document_id, null);
      result = resp.status === 200 ? { message: 'Document archived' } : { error: 'Archive failed: ' + (resp.data.error || 'HTTP ' + resp.status) };
      break;
    }
    default:
      result = { error: 'Unknown action: ' + action };
  }
  console.log(JSON.stringify(result));
}
main().catch(function(err) { console.log(JSON.stringify({ error: err.message })); });`;

// ── Manifest ──

export const manifest: ToolManifest = {
  id: 'docs',
  label: 'Documents',
  icon: ':page_facing_up:',
  description: 'Create and manage documents, spreadsheets, and files. No API keys needed.',
  configKeys: [],
  tools: [
    { name: 'docs-read', schema: READ_SCHEMA, code: READ_CODE, accessLevel: 'read-only', displayName: 'Reading documents' },
    { name: 'docs-write', schema: WRITE_SCHEMA, code: WRITE_CODE, accessLevel: 'read-write', displayName: 'Writing documents' },
  ],
  async register(workspaceId, _userId, _config) {
    const toolConfig: Record<string, string> = {
      api_url: `http://host.docker.internal:${appConfig.server.port}`,
    };
    if (appConfig.server.internalSecret) {
      toolConfig.internal_secret = appConfig.server.internalSecret;
    }

    const existingRead = await getCustomTool(workspaceId, 'docs-read');
    if (!existingRead) {
      await registerCustomTool(workspaceId, 'docs-read', READ_SCHEMA, null, 'system', {
        code: READ_CODE,
        language: 'javascript',
        autoApprove: true,
        accessLevel: 'read-only',
        configJson: JSON.stringify(toolConfig),
      });
    }

    const existingWrite = await getCustomTool(workspaceId, 'docs-write');
    if (!existingWrite) {
      await registerCustomTool(workspaceId, 'docs-write', WRITE_SCHEMA, null, 'system', {
        code: WRITE_CODE,
        language: 'javascript',
        autoApprove: true,
        accessLevel: 'read-write',
        configJson: JSON.stringify(toolConfig),
      });
    }

    logger.info('Docs tools registered');
  },
  async updateConfig(_workspaceId) {
    // Docs config is derived from app config, not user-provided
  },
};
