import { registerCustomTool, getCustomTool } from '../../index';
import { execute } from '../../../../db';
import { logger } from '../../../../utils/logger';
import type { ToolManifest } from '../manifest';

// ── Schema & Code ──

const READ_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Search engine results page (SERP) rankings across Google, Bing, and Yahoo. Check keyword positions, get organic results with rankings.',
  properties: {
    action: {
      type: 'string',
      enum: ['search', 'batch_search'],
      description: 'The SerpAPI action to perform',
    },
    keyword: { type: 'string', description: 'Search keyword/query (for search action)' },
    keywords: { type: 'array', items: { type: 'string' }, description: 'Array of search keywords (for batch_search action)' },
    engine: { type: 'string', enum: ['google', 'bing', 'yahoo'], description: 'Search engine to use (default: google)' },
    location: { type: 'string', description: 'Location for localized results (e.g. "Austin, Texas")' },
    device: { type: 'string', enum: ['desktop', 'mobile', 'tablet'], description: 'Device type (default: desktop)' },
    num: { type: 'number', description: 'Number of results to return (default 10, max 100)' },
  },
  required: ['action'],
});

const READ_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'serpapi-read.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const apiKey = config.api_key;

if (!apiKey) {
  console.log(JSON.stringify({ error: 'SerpAPI credentials not configured. Admin must set api_key in tool config.' }));
  process.exit(0);
}

function serpRequest(params) {
  return new Promise(function(resolve, reject) {
    var qs = Object.keys(params).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    var options = {
      hostname: 'serpapi.com',
      path: '/search.json?' + qs,
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    };
    var req = https.request(options, function(res) {
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
    req.setTimeout(30000, function() { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

function extractResults(data) {
  var organic = (data.organic_results || []).map(function(r) {
    return { position: r.position, title: r.title, link: r.link, snippet: r.snippet };
  });
  return {
    search_metadata: {
      query: data.search_parameters ? data.search_parameters.q : '',
      engine: data.search_parameters ? data.search_parameters.engine : '',
      total_results: data.search_information ? data.search_information.total_results : null,
    },
    organic_results: organic,
  };
}

async function main() {
  var action = input.action;
  var engine = input.engine || 'google';
  var num = Math.min(input.num || 10, 100);
  var result;

  switch (action) {
    case 'search': {
      if (!input.keyword) { result = { error: 'keyword is required for search' }; break; }
      var params = { api_key: apiKey, q: input.keyword, engine: engine, num: num };
      if (input.location) params.location = input.location;
      if (input.device) params.device = input.device;
      var resp = await serpRequest(params);
      if (resp.status === 200) {
        result = extractResults(resp.data);
      } else {
        result = resp;
      }
      break;
    }
    case 'batch_search': {
      if (!input.keywords || !input.keywords.length) { result = { error: 'keywords array is required for batch_search' }; break; }
      var results = [];
      for (var i = 0; i < input.keywords.length; i++) {
        var kw = input.keywords[i];
        var bParams = { api_key: apiKey, q: kw, engine: engine, num: num };
        if (input.location) bParams.location = input.location;
        if (input.device) bParams.device = input.device;
        try {
          var bResp = await serpRequest(bParams);
          if (bResp.status === 200) {
            results.push({ keyword: kw, results: extractResults(bResp.data) });
          } else {
            results.push({ keyword: kw, error: 'HTTP ' + bResp.status });
          }
        } catch(e) {
          results.push({ keyword: kw, error: e.message });
        }
      }
      result = { batch_results: results };
      break;
    }
    default:
      result = { error: 'Unknown action: ' + action + '. Valid actions: search, batch_search' };
  }

  console.log(JSON.stringify(result));
}

main().catch(function(err) {
  console.log(JSON.stringify({ error: err.message }));
});`;

// ── Manifest ──

export const manifest: ToolManifest = {
  id: 'serpapi',
  label: 'SerpAPI',
  icon: ':mag:',
  description: 'SERP rankings across Google, Bing, Yahoo.',
  configKeys: ['api_key'],
  configPlaceholders: {
    api_key: 'API key from serpapi.com/manage-api-key',
  },
  connectionModel: 'team',
  tools: [
    { name: 'serpapi-read', schema: READ_SCHEMA, code: READ_CODE, accessLevel: 'read-only', displayName: 'Searching SerpAPI' },
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
