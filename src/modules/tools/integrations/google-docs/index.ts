import { registerCustomTool, getCustomTool } from '../../index';
import { execute } from '../../../../db';
import { logger } from '../../../../utils/logger';
import type { ToolManifest } from '../manifest';

// ── Helper (shared by read & write code) ──

const GOOGLE_REQUEST_FN = `function googleRequest(url, method, body) {
  return new Promise(function(resolve, reject) {
    var payload = body ? JSON.stringify(body) : null;
    var parsed = new URL(url);
    var opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/json',
      },
      timeout: 25000,
    };
    if (payload) {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    var req = https.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, data: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('Request timed out')); });
    if (payload) req.write(payload);
    req.end();
  });
}`;

// ── Schemas & Code ──

const READ_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Read content from Google Docs documents.',
  properties: {
    action: {
      type: 'string',
      enum: ['read_doc'],
      description: 'The action to perform',
    },
    document_id: { type: 'string', description: 'Google Doc ID' },
  },
  required: ['action', 'document_id'],
});

const READ_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'google-docs-read.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const token = config.access_token;
if (!token) {
  console.log(JSON.stringify({ error: 'Google Docs not connected. Go to Connections to connect your Google account.' }));
  process.exit(0);
}

${GOOGLE_REQUEST_FN}

async function run() {
  var action = input.action;

  switch (action) {
    case 'read_doc': {
      if (!input.document_id) return { error: 'document_id is required' };
      var res = await googleRequest(
        'https://docs.googleapis.com/v1/documents/' + input.document_id,
        'GET'
      );
      if (res.status !== 200) return { error: 'Docs API error', status: res.status, details: res.data };
      // Extract text content from doc body
      var text = '';
      function extractText(elements) {
        if (!elements) return;
        for (var el of elements) {
          if (el.paragraph && el.paragraph.elements) {
            for (var pe of el.paragraph.elements) {
              if (pe.textRun && pe.textRun.content) text += pe.textRun.content;
            }
          }
          if (el.table) {
            for (var row of (el.table.tableRows || [])) {
              for (var cell of (row.tableCells || [])) {
                extractText(cell.content);
              }
            }
          }
        }
      }
      extractText(res.data.body && res.data.body.content);
      return { title: res.data.title, text: text.slice(0, 50000) };
    }
    default:
      return { error: 'Unknown action: ' + action + '. Use read_doc.' };
  }
}
run().then(function(r) { console.log(JSON.stringify(r)); }).catch(function(e) { console.log(JSON.stringify({ error: e.message })); });
`;

const WRITE_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Create and update Google Docs documents.',
  properties: {
    action: {
      type: 'string',
      enum: ['create_doc', 'update_doc'],
      description: 'The write action to perform',
    },
    title: { type: 'string', description: 'Title for new document (for create_doc)' },
    content: { type: 'string', description: 'Text content for the document' },
    document_id: { type: 'string', description: 'Document ID (for update_doc)' },
    parent_folder_id: { type: 'string', description: 'Parent folder ID in Drive (optional, for create_doc)' },
  },
  required: ['action'],
});

const WRITE_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'google-docs-write.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const token = config.access_token;
if (!token) {
  console.log(JSON.stringify({ error: 'Google Docs not connected. Go to Connections to connect your Google account.' }));
  process.exit(0);
}

${GOOGLE_REQUEST_FN}

async function run() {
  var action = input.action;

  switch (action) {
    case 'create_doc': {
      if (!input.title) return { error: 'title is required' };
      // Create doc via Drive API
      var metadata = { name: input.title, mimeType: 'application/vnd.google-apps.document' };
      if (input.parent_folder_id) metadata.parents = [input.parent_folder_id];
      var res = await googleRequest('https://www.googleapis.com/drive/v3/files', 'POST', metadata);
      if (res.status !== 200) return { error: 'Drive API error', status: res.status, details: res.data };
      var docId = res.data.id;
      // Insert content if provided
      if (input.content) {
        await googleRequest(
          'https://docs.googleapis.com/v1/documents/' + docId + ':batchUpdate',
          'POST',
          { requests: [{ insertText: { location: { index: 1 }, text: input.content } }] }
        );
      }
      return { document_id: docId, url: 'https://docs.google.com/document/d/' + docId };
    }
    case 'update_doc': {
      if (!input.document_id) return { error: 'document_id is required' };
      if (!input.content) return { error: 'content is required' };
      // Get current doc to find end index
      var current = await googleRequest(
        'https://docs.googleapis.com/v1/documents/' + input.document_id,
        'GET'
      );
      if (current.status !== 200) return { error: 'Docs API error', status: current.status, details: current.data };
      var endIndex = 1;
      if (current.data.body && current.data.body.content) {
        var lastEl = current.data.body.content[current.data.body.content.length - 1];
        if (lastEl && lastEl.endIndex) endIndex = lastEl.endIndex - 1;
      }
      var requests = [];
      // Delete existing content if any
      if (endIndex > 1) {
        requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex } } });
      }
      // Insert new content
      requests.push({ insertText: { location: { index: 1 }, text: input.content } });
      var res2 = await googleRequest(
        'https://docs.googleapis.com/v1/documents/' + input.document_id + ':batchUpdate',
        'POST',
        { requests: requests }
      );
      if (res2.status !== 200) return { error: 'Docs API error', status: res2.status, details: res2.data };
      return { document_id: input.document_id, url: 'https://docs.google.com/document/d/' + input.document_id, updated: true };
    }
    default:
      return { error: 'Unknown action: ' + action + '. Use create_doc or update_doc.' };
  }
}
run().then(function(r) { console.log(JSON.stringify(r)); }).catch(function(e) { console.log(JSON.stringify({ error: e.message })); });
`;

// ── Manifest ──

export const manifest: ToolManifest = {
  id: 'google-docs',
  label: 'Google Docs',
  icon: ':page_facing_up:',
  description: 'Read and create documents.',
  configKeys: ['access_token'],
  setupGuide: 'Connect your Google account via OAuth from the Connections page. Go to Connections > Add Connection > Google, then authorize access. Your documents will be accessible once connected.',
  configPlaceholders: {
    access_token: 'Connected via OAuth',
  },
  connectionModel: 'personal',
  tools: [
    { name: 'google-docs-read', schema: READ_SCHEMA, code: READ_CODE, accessLevel: 'read-only', displayName: 'Reading Google Docs' },
    { name: 'google-docs-write', schema: WRITE_SCHEMA, code: WRITE_CODE, accessLevel: 'read-write', displayName: 'Updating Google Docs' },
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
    for (const tool of this.tools) {
      await execute(
        'UPDATE custom_tools SET config_json = $1 WHERE workspace_id = $2 AND name = $3',
        [configJson, workspaceId, tool.name],
      );
    }
  },
};
