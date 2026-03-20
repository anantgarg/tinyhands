import { registerCustomTool, getCustomTool } from '../../index';
import { execute } from '../../../../db';
import { logger } from '../../../../utils/logger';
import type { ToolManifest } from '../manifest';

// ── Schemas & Code ──

const READ_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Read from Google Workspace: search Drive files, read Sheets, read Docs, list files in folders.',
  properties: {
    action: {
      type: 'string',
      enum: ['search_drive', 'list_files', 'get_file_metadata', 'read_sheet', 'read_doc'],
      description: 'The Google Workspace action to perform',
    },
    query: { type: 'string', description: 'Search query for Drive (for search_drive)' },
    folder_id: { type: 'string', description: 'Folder ID to list files from (for list_files). Use "root" for top-level.' },
    file_id: { type: 'string', description: 'File ID (for get_file_metadata)' },
    spreadsheet_id: { type: 'string', description: 'Spreadsheet ID (for read_sheet)' },
    range: { type: 'string', description: 'A1 notation range, e.g. "Sheet1!A1:D10" (for read_sheet). Omit to read all.' },
    document_id: { type: 'string', description: 'Google Doc ID (for read_doc)' },
    page_size: { type: 'number', description: 'Max results (default 20, max 100)' },
  },
  required: ['action'],
});

const READ_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'google-read.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const token = config.access_token;
if (!token) {
  console.log(JSON.stringify({ error: 'Google not connected. Use /tools to connect your Google account.' }));
  process.exit(0);
}

function googleRequest(url, method, body) {
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
}

async function run() {
  var action = input.action;
  var pageSize = Math.min(input.page_size || 20, 100);

  switch (action) {
    case 'search_drive': {
      if (!input.query) return { error: 'query is required for search_drive' };
      var q = encodeURIComponent(input.query);
      var res = await googleRequest(
        'https://www.googleapis.com/drive/v3/files?q=fullText+contains+%27' + q + '%27&pageSize=' + pageSize + '&fields=files(id,name,mimeType,modifiedTime,webViewLink,size)',
        'GET'
      );
      if (res.status !== 200) return { error: 'Drive API error', status: res.status, details: res.data };
      return { files: res.data.files || [] };
    }
    case 'list_files': {
      var folderId = input.folder_id || 'root';
      var q2 = encodeURIComponent("'" + folderId + "' in parents and trashed = false");
      var res2 = await googleRequest(
        'https://www.googleapis.com/drive/v3/files?q=' + q2 + '&pageSize=' + pageSize + '&fields=files(id,name,mimeType,modifiedTime,webViewLink,size)&orderBy=modifiedTime+desc',
        'GET'
      );
      if (res2.status !== 200) return { error: 'Drive API error', status: res2.status, details: res2.data };
      return { files: res2.data.files || [] };
    }
    case 'get_file_metadata': {
      if (!input.file_id) return { error: 'file_id is required' };
      var res3 = await googleRequest(
        'https://www.googleapis.com/drive/v3/files/' + input.file_id + '?fields=id,name,mimeType,modifiedTime,createdTime,webViewLink,size,owners,lastModifyingUser',
        'GET'
      );
      if (res3.status !== 200) return { error: 'Drive API error', status: res3.status, details: res3.data };
      return res3.data;
    }
    case 'read_sheet': {
      if (!input.spreadsheet_id) return { error: 'spreadsheet_id is required' };
      var range = input.range ? encodeURIComponent(input.range) : '';
      var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + input.spreadsheet_id;
      if (range) url += '/values/' + range;
      else url += '?includeGridData=false';
      var res4 = await googleRequest(url, 'GET');
      if (res4.status !== 200) return { error: 'Sheets API error', status: res4.status, details: res4.data };
      return res4.data;
    }
    case 'read_doc': {
      if (!input.document_id) return { error: 'document_id is required' };
      var res5 = await googleRequest(
        'https://docs.googleapis.com/v1/documents/' + input.document_id,
        'GET'
      );
      if (res5.status !== 200) return { error: 'Docs API error', status: res5.status, details: res5.data };
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
      extractText(res5.data.body && res5.data.body.content);
      return { title: res5.data.title, text: text.slice(0, 50000) };
    }
    default:
      return { error: 'Unknown action: ' + action + '. Use search_drive, list_files, get_file_metadata, read_sheet, or read_doc.' };
  }
}
run().then(function(r) { console.log(JSON.stringify(r)); }).catch(function(e) { console.log(JSON.stringify({ error: e.message })); });
`;

const WRITE_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Write to Google Workspace: create/update Sheets, create Docs, upload files, create folders.',
  properties: {
    action: {
      type: 'string',
      enum: ['update_sheet', 'append_sheet', 'create_sheet', 'create_doc', 'create_folder'],
      description: 'The write action to perform',
    },
    spreadsheet_id: { type: 'string', description: 'Spreadsheet ID (for update_sheet, append_sheet)' },
    range: { type: 'string', description: 'A1 notation range, e.g. "Sheet1!A1:D10"' },
    values: { type: 'array', items: { type: 'array' }, description: '2D array of cell values' },
    title: { type: 'string', description: 'Title for new spreadsheet, doc, or folder' },
    content: { type: 'string', description: 'Text content for new doc' },
    parent_folder_id: { type: 'string', description: 'Parent folder ID (optional)' },
  },
  required: ['action'],
});

const WRITE_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'google-write.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const token = config.access_token;
if (!token) {
  console.log(JSON.stringify({ error: 'Google not connected. Use /tools to connect your Google account.' }));
  process.exit(0);
}

function googleRequest(url, method, body) {
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
}

async function run() {
  var action = input.action;

  switch (action) {
    case 'update_sheet': {
      if (!input.spreadsheet_id || !input.range || !input.values) return { error: 'spreadsheet_id, range, and values are required' };
      var res = await googleRequest(
        'https://sheets.googleapis.com/v4/spreadsheets/' + input.spreadsheet_id + '/values/' + encodeURIComponent(input.range) + '?valueInputOption=USER_ENTERED',
        'PUT',
        { range: input.range, majorDimension: 'ROWS', values: input.values }
      );
      if (res.status !== 200) return { error: 'Sheets API error', status: res.status, details: res.data };
      return { updated: res.data.updatedCells + ' cells', range: res.data.updatedRange };
    }
    case 'append_sheet': {
      if (!input.spreadsheet_id || !input.range || !input.values) return { error: 'spreadsheet_id, range, and values are required' };
      var res2 = await googleRequest(
        'https://sheets.googleapis.com/v4/spreadsheets/' + input.spreadsheet_id + '/values/' + encodeURIComponent(input.range) + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
        'POST',
        { range: input.range, majorDimension: 'ROWS', values: input.values }
      );
      if (res2.status !== 200) return { error: 'Sheets API error', status: res2.status, details: res2.data };
      return { appended: res2.data.updates && res2.data.updates.updatedCells + ' cells' };
    }
    case 'create_sheet': {
      if (!input.title) return { error: 'title is required' };
      var res3 = await googleRequest(
        'https://sheets.googleapis.com/v4/spreadsheets',
        'POST',
        { properties: { title: input.title } }
      );
      if (res3.status !== 200) return { error: 'Sheets API error', status: res3.status, details: res3.data };
      return { spreadsheet_id: res3.data.spreadsheetId, url: res3.data.spreadsheetUrl, title: res3.data.properties.title };
    }
    case 'create_doc': {
      if (!input.title) return { error: 'title is required' };
      // Create doc via Drive API (Docs API create is limited)
      var metadata = { name: input.title, mimeType: 'application/vnd.google-apps.document' };
      if (input.parent_folder_id) metadata.parents = [input.parent_folder_id];
      var res4 = await googleRequest('https://www.googleapis.com/drive/v3/files', 'POST', metadata);
      if (res4.status !== 200) return { error: 'Drive API error', status: res4.status, details: res4.data };
      var docId = res4.data.id;
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
    case 'create_folder': {
      if (!input.title) return { error: 'title is required' };
      var folderMeta = { name: input.title, mimeType: 'application/vnd.google-apps.folder' };
      if (input.parent_folder_id) folderMeta.parents = [input.parent_folder_id];
      var res5 = await googleRequest('https://www.googleapis.com/drive/v3/files', 'POST', folderMeta);
      if (res5.status !== 200) return { error: 'Drive API error', status: res5.status, details: res5.data };
      return { folder_id: res5.data.id, name: res5.data.name };
    }
    default:
      return { error: 'Unknown action: ' + action };
  }
}
run().then(function(r) { console.log(JSON.stringify(r)); }).catch(function(e) { console.log(JSON.stringify({ error: e.message })); });
`;

// ── Manifest ──

export const manifest: ToolManifest = {
  id: 'google',
  label: 'Google Workspace',
  icon: ':file_folder:',
  description: 'Search Drive, read/write Sheets, read/create Docs, manage folders.',
  configKeys: ['access_token'],
  setupGuide: 'How to connect:\n1. For personal use: Go to Connections > Add Connection and connect via OAuth\n2. For team use: Create a Google service account, enable Drive/Sheets APIs, and paste the access token here\n3. Or use an OAuth refresh token from your Google Cloud Console',
  configPlaceholders: {
    access_token: 'OAuth token or service account token',
  },
  connectionModel: 'personal',
  tools: [
    { name: 'google-read', schema: READ_SCHEMA, code: READ_CODE, accessLevel: 'read-only', displayName: 'Checking Google Workspace' },
    { name: 'google-write', schema: WRITE_SCHEMA, code: WRITE_CODE, accessLevel: 'read-write', displayName: 'Updating Google Workspace' },
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
