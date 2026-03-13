import { registerCustomTool, getCustomTool } from '../../index';
import { config as appConfig } from '../../../../config';
import { logger } from '../../../../utils/logger';
import type { ToolManifest } from '../manifest';

// ── Schema & Code ──

const READ_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Search and browse the internal knowledge base. Find articles, documentation, and reference material by keyword or category.',
  properties: {
    action: {
      type: 'string',
      enum: ['search', 'list', 'categories'],
      description: 'The action to perform: search (find by query), list (browse entries), categories (list available categories)',
    },
    query: { type: 'string', description: 'Search query text (required for search action)' },
    category: { type: 'string', description: 'Filter by category (optional, for list action)' },
    limit: { type: 'number', description: 'Max results to return (default 10, max 20)' },
  },
  required: ['action'],
});

const READ_CODE = `var http = require('http');
var fs = require('fs');
var path = require('path');

var configPath = path.join(__dirname, 'kb-search.config.json');
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
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    if (secret) {
      options.headers['X-Internal-Secret'] = secret;
    }
    var req = http.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch(e) {
          resolve({ status: res.statusCode, data: data.slice(0, 2000) });
        }
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
  var limit = Math.min(input.limit || 10, 20);
  var result;

  switch (action) {
    case 'search': {
      if (!input.query) { result = { error: 'query is required for search action' }; break; }
      var resp = await httpRequest('POST', '/internal/kb/search', {
        query: input.query,
        agent_id: process.env.AGENT_ID || undefined,
        limit: limit * 400,
      });
      if (resp.status === 200) {
        var entries = resp.data.results || [];
        if (entries.length === 0) {
          result = { message: 'No results found for: ' + input.query, results: [] };
        } else {
          result = {
            message: 'Found ' + entries.length + ' result(s)',
            results: entries.slice(0, limit).map(function(e) {
              return { title: e.title, summary: e.summary, content: e.content, category: e.category, tags: e.tags };
            }),
          };
        }
      } else {
        result = { error: 'Search failed: HTTP ' + resp.status };
      }
      break;
    }
    case 'list': {
      var qs = '?limit=' + limit;
      if (input.category) qs += '&category=' + encodeURIComponent(input.category);
      var listResp = await httpRequest('GET', '/internal/kb/list' + qs, null);
      if (listResp.status === 200) {
        result = {
          message: 'Found ' + (listResp.data.entries || []).length + ' entries',
          entries: listResp.data.entries || [],
        };
      } else {
        result = { error: 'List failed: HTTP ' + listResp.status };
      }
      break;
    }
    case 'categories': {
      var catResp = await httpRequest('GET', '/internal/kb/categories', null);
      if (catResp.status === 200) {
        result = { categories: catResp.data.categories || [] };
      } else {
        result = { error: 'Categories failed: HTTP ' + catResp.status };
      }
      break;
    }
    default:
      result = { error: 'Unknown action: ' + action + '. Valid actions: search, list, categories' };
  }

  console.log(JSON.stringify(result));
}

main().catch(function(err) {
  console.log(JSON.stringify({ error: err.message }));
});`;

// ── Manifest ──

export const manifest: ToolManifest = {
  id: 'kb',
  label: 'Knowledge Base',
  icon: ':books:',
  description: 'Search and browse the internal knowledge base. No API keys needed.',
  configKeys: [],
  tools: [
    { name: 'kb-search', schema: READ_SCHEMA, code: READ_CODE, accessLevel: 'read-only', displayName: 'Searching knowledge base' },
  ],
  async register(_userId, _config) {
    const existing = await getCustomTool('kb-search');
    if (existing) return;

    const toolConfig: Record<string, string> = {
      api_url: `http://host.docker.internal:${appConfig.server.port}`,
    };
    if (appConfig.server.internalSecret) {
      toolConfig.internal_secret = appConfig.server.internalSecret;
    }

    await registerCustomTool('kb-search', READ_SCHEMA, null, 'system', {
      code: READ_CODE,
      language: 'javascript',
      autoApprove: true,
      accessLevel: 'read-only',
      configJson: JSON.stringify(toolConfig),
    });
    logger.info('KB search tool registered');
  },
  async updateConfig() {
    // KB config is derived from app config, not user-provided
  },
};
