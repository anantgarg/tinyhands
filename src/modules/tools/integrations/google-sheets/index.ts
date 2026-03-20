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
  description: 'Read data from Google Sheets spreadsheets.',
  properties: {
    action: {
      type: 'string',
      enum: ['read_sheet', 'get_spreadsheet_info'],
      description: 'The action to perform',
    },
    spreadsheet_id: { type: 'string', description: 'Spreadsheet ID' },
    range: { type: 'string', description: 'A1 notation range, e.g. "Sheet1!A1:D10" (for read_sheet). Omit to read all.' },
  },
  required: ['action', 'spreadsheet_id'],
});

const READ_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'google-sheets-read.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const token = config.access_token;
if (!token) {
  console.log(JSON.stringify({ error: 'Google Sheets not connected. Go to Connections to connect your Google account.' }));
  process.exit(0);
}

${GOOGLE_REQUEST_FN}

async function run() {
  var action = input.action;

  switch (action) {
    case 'read_sheet': {
      if (!input.spreadsheet_id) return { error: 'spreadsheet_id is required' };
      var range = input.range ? encodeURIComponent(input.range) : '';
      var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + input.spreadsheet_id;
      if (range) url += '/values/' + range;
      else url += '?includeGridData=false';
      var res = await googleRequest(url, 'GET');
      if (res.status !== 200) return { error: 'Sheets API error', status: res.status, details: res.data };
      return res.data;
    }
    case 'get_spreadsheet_info': {
      if (!input.spreadsheet_id) return { error: 'spreadsheet_id is required' };
      var res2 = await googleRequest(
        'https://sheets.googleapis.com/v4/spreadsheets/' + input.spreadsheet_id + '?fields=spreadsheetId,properties.title,sheets.properties',
        'GET'
      );
      if (res2.status !== 200) return { error: 'Sheets API error', status: res2.status, details: res2.data };
      return {
        spreadsheet_id: res2.data.spreadsheetId,
        title: res2.data.properties && res2.data.properties.title,
        sheets: (res2.data.sheets || []).map(function(s) {
          return {
            title: s.properties.title,
            sheet_id: s.properties.sheetId,
            row_count: s.properties.gridProperties && s.properties.gridProperties.rowCount,
            column_count: s.properties.gridProperties && s.properties.gridProperties.columnCount,
          };
        }),
      };
    }
    default:
      return { error: 'Unknown action: ' + action + '. Use read_sheet or get_spreadsheet_info.' };
  }
}
run().then(function(r) { console.log(JSON.stringify(r)); }).catch(function(e) { console.log(JSON.stringify({ error: e.message })); });
`;

const WRITE_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Create and update Google Sheets spreadsheets.',
  properties: {
    action: {
      type: 'string',
      enum: ['create_sheet', 'update_sheet', 'append_sheet'],
      description: 'The write action to perform',
    },
    title: { type: 'string', description: 'Title for new spreadsheet (for create_sheet)' },
    spreadsheet_id: { type: 'string', description: 'Spreadsheet ID (for update_sheet, append_sheet)' },
    range: { type: 'string', description: 'A1 notation range, e.g. "Sheet1!A1:D10"' },
    values: { type: 'array', items: { type: 'array' }, description: '2D array of cell values' },
  },
  required: ['action'],
});

const WRITE_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'google-sheets-write.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const token = config.access_token;
if (!token) {
  console.log(JSON.stringify({ error: 'Google Sheets not connected. Go to Connections to connect your Google account.' }));
  process.exit(0);
}

${GOOGLE_REQUEST_FN}

async function run() {
  var action = input.action;

  switch (action) {
    case 'create_sheet': {
      if (!input.title) return { error: 'title is required' };
      var res = await googleRequest(
        'https://sheets.googleapis.com/v4/spreadsheets',
        'POST',
        { properties: { title: input.title } }
      );
      if (res.status !== 200) return { error: 'Sheets API error', status: res.status, details: res.data };
      return { spreadsheet_id: res.data.spreadsheetId, url: res.data.spreadsheetUrl, title: res.data.properties.title };
    }
    case 'update_sheet': {
      if (!input.spreadsheet_id || !input.range || !input.values) return { error: 'spreadsheet_id, range, and values are required' };
      var res2 = await googleRequest(
        'https://sheets.googleapis.com/v4/spreadsheets/' + input.spreadsheet_id + '/values/' + encodeURIComponent(input.range) + '?valueInputOption=USER_ENTERED',
        'PUT',
        { range: input.range, majorDimension: 'ROWS', values: input.values }
      );
      if (res2.status !== 200) return { error: 'Sheets API error', status: res2.status, details: res2.data };
      return { updated: res2.data.updatedCells + ' cells', range: res2.data.updatedRange };
    }
    case 'append_sheet': {
      if (!input.spreadsheet_id || !input.range || !input.values) return { error: 'spreadsheet_id, range, and values are required' };
      var res3 = await googleRequest(
        'https://sheets.googleapis.com/v4/spreadsheets/' + input.spreadsheet_id + '/values/' + encodeURIComponent(input.range) + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
        'POST',
        { range: input.range, majorDimension: 'ROWS', values: input.values }
      );
      if (res3.status !== 200) return { error: 'Sheets API error', status: res3.status, details: res3.data };
      return { appended: res3.data.updates && res3.data.updates.updatedCells + ' cells' };
    }
    default:
      return { error: 'Unknown action: ' + action + '. Use create_sheet, update_sheet, or append_sheet.' };
  }
}
run().then(function(r) { console.log(JSON.stringify(r)); }).catch(function(e) { console.log(JSON.stringify({ error: e.message })); });
`;

// ── Manifest ──

export const manifest: ToolManifest = {
  id: 'google-sheets',
  label: 'Google Sheets',
  icon: ':bar_chart:',
  description: 'Read and write spreadsheet data.',
  configKeys: ['access_token'],
  setupGuide: 'Connect your Google account via OAuth from the Connections page. Go to Connections > Add Connection > Google, then authorize access. Your spreadsheets will be accessible once connected.',
  configPlaceholders: {
    access_token: 'Connected via OAuth',
  },
  connectionModel: 'personal',
  tools: [
    { name: 'google-sheets-read', schema: READ_SCHEMA, code: READ_CODE, accessLevel: 'read-only', displayName: 'Reading Google Sheets' },
    { name: 'google-sheets-write', schema: WRITE_SCHEMA, code: WRITE_CODE, accessLevel: 'read-write', displayName: 'Updating Google Sheets' },
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
