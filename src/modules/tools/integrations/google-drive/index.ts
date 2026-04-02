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
  description: 'Search and browse Google Drive files and folders, get file metadata, download file content.',
  properties: {
    action: {
      type: 'string',
      enum: ['search', 'list_files', 'get_metadata', 'download'],
      description: 'The Google Drive action to perform',
    },
    query: { type: 'string', description: 'Search query for Drive (for search)' },
    folder_id: { type: 'string', description: 'Folder ID to list files from (for list_files). Use "root" for top-level.' },
    file_id: { type: 'string', description: 'File ID (for get_metadata or download)' },
    page_size: { type: 'number', description: 'Max results (default 20, max 100)' },
  },
  required: ['action'],
});

const READ_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'google-drive-read.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const token = config.access_token;
if (!token) {
  console.log(JSON.stringify({ error: 'Google Drive not connected. Go to Connections to connect your Google account.' }));
  process.exit(0);
}

var rootFolderId = config.root_folder_id || null;
var rootFolderName = config.root_folder_name || null;

${GOOGLE_REQUEST_FN}

async function run() {
  var action = input.action;
  var pageSize = Math.min(input.page_size || 20, 100);

  switch (action) {
    case 'search': {
      if (!input.query) return { error: 'query is required for search' };
      var q = encodeURIComponent(input.query);
      var searchQ = 'fullText+contains+%27' + q + '%27';
      // If restricted to a folder, scope search to that folder's descendants
      if (rootFolderId) {
        searchQ += '+and+%27' + rootFolderId + '%27+in+parents';
      }
      var res = await googleRequest(
        'https://www.googleapis.com/drive/v3/files?q=' + searchQ + '&pageSize=' + pageSize + '&fields=files(id,name,mimeType,modifiedTime,webViewLink,size)',
        'GET'
      );
      if (res.status !== 200) return { error: 'Drive API error', status: res.status, details: res.data };
      if (rootFolderId && rootFolderName) {
        return { restricted_to: rootFolderName, files: res.data.files || [] };
      }
      return { files: res.data.files || [] };
    }
    case 'list_files': {
      var folderId = input.folder_id || rootFolderId || 'root';
      var q2 = encodeURIComponent("'" + folderId + "' in parents and trashed = false");
      var res2 = await googleRequest(
        'https://www.googleapis.com/drive/v3/files?q=' + q2 + '&pageSize=' + pageSize + '&fields=files(id,name,mimeType,modifiedTime,webViewLink,size)&orderBy=modifiedTime+desc',
        'GET'
      );
      if (res2.status !== 200) return { error: 'Drive API error', status: res2.status, details: res2.data };
      return { files: res2.data.files || [] };
    }
    case 'get_metadata': {
      if (!input.file_id) return { error: 'file_id is required' };
      var res3 = await googleRequest(
        'https://www.googleapis.com/drive/v3/files/' + input.file_id + '?fields=id,name,mimeType,modifiedTime,createdTime,webViewLink,size,owners,lastModifyingUser',
        'GET'
      );
      if (res3.status !== 200) return { error: 'Drive API error', status: res3.status, details: res3.data };
      return res3.data;
    }
    case 'download': {
      if (!input.file_id) return { error: 'file_id is required' };
      // First get file metadata to determine type
      var meta = await googleRequest(
        'https://www.googleapis.com/drive/v3/files/' + input.file_id + '?fields=id,name,mimeType,size',
        'GET'
      );
      if (meta.status !== 200) return { error: 'Drive API error', status: meta.status, details: meta.data };
      var mimeType = meta.data.mimeType;
      var exportUrl;
      // Google Workspace files need export, others use direct download
      if (mimeType === 'application/vnd.google-apps.document') {
        exportUrl = 'https://www.googleapis.com/drive/v3/files/' + input.file_id + '/export?mimeType=text/plain';
      } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        exportUrl = 'https://www.googleapis.com/drive/v3/files/' + input.file_id + '/export?mimeType=text/csv';
      } else if (mimeType === 'application/vnd.google-apps.presentation') {
        exportUrl = 'https://www.googleapis.com/drive/v3/files/' + input.file_id + '/export?mimeType=text/plain';
      } else {
        exportUrl = 'https://www.googleapis.com/drive/v3/files/' + input.file_id + '?alt=media';
      }
      var res4 = await googleRequest(exportUrl, 'GET');
      if (res4.status !== 200) return { error: 'Drive API error', status: res4.status, details: res4.data };
      var content = typeof res4.data === 'string' ? res4.data : JSON.stringify(res4.data);
      return { file_name: meta.data.name, mime_type: mimeType, content: content.slice(0, 50000) };
    }
    default:
      return { error: 'Unknown action: ' + action + '. Use search, list_files, get_metadata, or download.' };
  }
}
run().then(function(r) { console.log(JSON.stringify(r)); }).catch(function(e) { console.log(JSON.stringify({ error: e.message })); });
`;

const WRITE_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Manage Google Drive: create folders, move files, upload files.',
  properties: {
    action: {
      type: 'string',
      enum: ['create_folder', 'move_file', 'upload'],
      description: 'The Google Drive write action to perform',
    },
    title: { type: 'string', description: 'Name for new folder or uploaded file' },
    parent_folder_id: { type: 'string', description: 'Parent folder ID (optional)' },
    file_id: { type: 'string', description: 'File ID to move (for move_file)' },
    destination_folder_id: { type: 'string', description: 'Destination folder ID (for move_file)' },
    content: { type: 'string', description: 'Text content for uploaded file (for upload)' },
    mime_type: { type: 'string', description: 'MIME type for uploaded file (default: text/plain)' },
  },
  required: ['action'],
});

const WRITE_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'google-drive-write.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const token = config.access_token;
if (!token) {
  console.log(JSON.stringify({ error: 'Google Drive not connected. Go to Connections to connect your Google account.' }));
  process.exit(0);
}

var rootFolderId = config.root_folder_id || null;

${GOOGLE_REQUEST_FN}

async function run() {
  var action = input.action;

  switch (action) {
    case 'create_folder': {
      if (!input.title) return { error: 'title is required' };
      var folderMeta = { name: input.title, mimeType: 'application/vnd.google-apps.folder' };
      var parentId = input.parent_folder_id || rootFolderId;
      if (parentId) folderMeta.parents = [parentId];
      var res = await googleRequest('https://www.googleapis.com/drive/v3/files', 'POST', folderMeta);
      if (res.status !== 200) return { error: 'Drive API error', status: res.status, details: res.data };
      return { folder_id: res.data.id, name: res.data.name };
    }
    case 'move_file': {
      if (!input.file_id || !input.destination_folder_id) return { error: 'file_id and destination_folder_id are required' };
      // Get current parents first
      var current = await googleRequest(
        'https://www.googleapis.com/drive/v3/files/' + input.file_id + '?fields=parents',
        'GET'
      );
      if (current.status !== 200) return { error: 'Drive API error', status: current.status, details: current.data };
      var removeParents = (current.data.parents || []).join(',');
      var res2 = await googleRequest(
        'https://www.googleapis.com/drive/v3/files/' + input.file_id + '?addParents=' + input.destination_folder_id + '&removeParents=' + removeParents + '&fields=id,name,parents',
        'PATCH',
        {}
      );
      if (res2.status !== 200) return { error: 'Drive API error', status: res2.status, details: res2.data };
      return { file_id: res2.data.id, name: res2.data.name, new_parents: res2.data.parents };
    }
    case 'upload': {
      if (!input.title || !input.content) return { error: 'title and content are required' };
      // Create file metadata first
      var fileMeta = { name: input.title };
      var uploadParent = input.parent_folder_id || rootFolderId;
      if (uploadParent) fileMeta.parents = [uploadParent];
      var created = await googleRequest('https://www.googleapis.com/drive/v3/files', 'POST', fileMeta);
      if (created.status !== 200) return { error: 'Drive API error', status: created.status, details: created.data };
      var fileId = created.data.id;
      // Upload content
      var mimeType = input.mime_type || 'text/plain';
      var uploadRes = await new Promise(function(resolve, reject) {
        var payload = input.content;
        var parsed = new URL('https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media');
        var opts = {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method: 'PATCH',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': mimeType,
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: 25000,
        };
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
        req.write(payload);
        req.end();
      });
      if (uploadRes.status !== 200) return { error: 'Upload error', status: uploadRes.status, details: uploadRes.data };
      return { file_id: fileId, name: input.title, url: 'https://drive.google.com/file/d/' + fileId };
    }
    default:
      return { error: 'Unknown action: ' + action + '. Use create_folder, move_file, or upload.' };
  }
}
run().then(function(r) { console.log(JSON.stringify(r)); }).catch(function(e) { console.log(JSON.stringify({ error: e.message })); });
`;

// ── Manifest ──

export const manifest: ToolManifest = {
  id: 'google-drive',
  label: 'Google Drive',
  icon: ':file_folder:',
  description: 'Search and browse files, manage folders.',
  configKeys: ['access_token'],
  setupGuide: 'Connect your Google account via OAuth from the Connections page. Go to Connections > Add Connection > Google, then authorize access. Your Drive files will be accessible once connected.',
  configPlaceholders: {
    access_token: 'Connected via OAuth',
  },
  tools: [
    { name: 'google-drive-read', schema: READ_SCHEMA, code: READ_CODE, accessLevel: 'read-only', displayName: 'Browsing Google Drive' },
    { name: 'google-drive-write', schema: WRITE_SCHEMA, code: WRITE_CODE, accessLevel: 'read-write', displayName: 'Updating Google Drive' },
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
