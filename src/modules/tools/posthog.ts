/**
 * PostHog tool registration — read-only analytics tool.
 *
 * Usage:
 *   registerPostHogTools('ADMIN_USER_ID', { api_key: 'phx_...', project_id: '12345' })
 */
import { registerCustomTool, getCustomTool } from './index';
import { execute } from '../../db';
import { logger } from '../../utils/logger';

// ── PostHog Read-Only Tool ──

const POSTHOG_READ_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Read-only access to PostHog analytics: query events, get person details, list feature flags, get insights and cohorts.',
  properties: {
    action: {
      type: 'string',
      enum: ['query_events', 'get_person', 'list_feature_flags', 'get_insight', 'list_insights', 'get_cohorts'],
      description: 'The PostHog action to perform',
    },
    event_name: {
      type: 'string',
      description: 'Event name filter (for query_events)',
    },
    person_id: {
      type: 'string',
      description: 'Person distinct_id (for get_person)',
    },
    insight_id: {
      type: 'number',
      description: 'Insight ID (for get_insight)',
    },
    date_from: {
      type: 'string',
      description: 'Start date — ISO format or relative like "-7d", "-30d" (default -7d)',
    },
    date_to: {
      type: 'string',
      description: 'End date — ISO format or relative (default now)',
    },
    properties: {
      type: 'object',
      description: 'Property filters as key-value pairs (for query_events)',
    },
    limit: {
      type: 'number',
      description: 'Max results (default 100, max 1000)',
    },
    offset: {
      type: 'number',
      description: 'Pagination offset (default 0)',
    },
  },
  required: ['action'],
});

const POSTHOG_READ_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'posthog-read.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const apiKey = config.api_key;
const projectId = config.project_id;
const hostRaw = config.host || 'https://app.posthog.com';
const host = hostRaw.replace(/\\/$/, '');

if (!apiKey || !projectId) {
  console.log(JSON.stringify({ error: 'PostHog credentials not configured. Admin must set api_key and project_id in tool config.' }));
  process.exit(0);
}

function posthogRequest(reqPath, method, body) {
  return new Promise((resolve, reject) => {
    var url;
    try { url = new URL(host + reqPath); } catch(e) { url = new URL('https://app.posthog.com' + reqPath); }
    var payload = body ? JSON.stringify(body) : null;
    var options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
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
    if (payload) req.write(payload);
    req.end();
  });
}

var prefix = '/api/projects/' + projectId;

async function main() {
  var a = input.action;
  var lim = Math.min(input.limit || 100, 1000);
  var offset = input.offset || 0;
  var result;

  switch (a) {
    case 'query_events': {
      var p = prefix + '/events/?limit=' + lim + '&offset=' + offset;
      if (input.event_name) p += '&event=' + encodeURIComponent(input.event_name);
      if (input.date_from) p += '&after=' + encodeURIComponent(input.date_from);
      if (input.date_to) p += '&before=' + encodeURIComponent(input.date_to);
      if (input.properties) p += '&properties=' + encodeURIComponent(JSON.stringify(input.properties));
      result = await posthogRequest(p);
      break;
    }
    case 'get_person': {
      if (!input.person_id) { result = { error: 'person_id (distinct_id) is required' }; break; }
      result = await posthogRequest(prefix + '/persons/?distinct_id=' + encodeURIComponent(input.person_id));
      break;
    }
    case 'list_feature_flags': {
      result = await posthogRequest(prefix + '/feature_flags/?limit=' + lim + '&offset=' + offset);
      break;
    }
    case 'get_insight': {
      if (!input.insight_id) { result = { error: 'insight_id is required' }; break; }
      result = await posthogRequest(prefix + '/insights/' + input.insight_id + '/');
      break;
    }
    case 'list_insights': {
      result = await posthogRequest(prefix + '/insights/?limit=' + lim + '&offset=' + offset);
      break;
    }
    case 'get_cohorts': {
      result = await posthogRequest(prefix + '/cohorts/?limit=' + lim);
      break;
    }
    default:
      result = { error: 'Unknown action: ' + a + '. Valid: query_events, get_person, list_feature_flags, get_insight, list_insights, get_cohorts' };
  }

  console.log(JSON.stringify(result));
}

main().catch(function(err) {
  console.log(JSON.stringify({ error: err.message }));
});`;

// ── Registration ──

export async function registerPostHogTools(
  adminUserId: string,
  posthogConfig: { api_key: string; project_id: string; host?: string },
): Promise<void> {
  const configJson = JSON.stringify(posthogConfig);

  const existing = await getCustomTool('posthog-read');
  if (!existing) {
    await registerCustomTool('posthog-read', POSTHOG_READ_SCHEMA, null, adminUserId, {
      code: POSTHOG_READ_CODE,
      language: 'javascript',
      autoApprove: true,
      accessLevel: 'read-only',
      configJson,
    });
    logger.info('PostHog read-only tool registered');
  } else {
    logger.info('PostHog read-only tool already exists, skipping');
  }
}

export async function updatePostHogConfig(
  posthogConfig: { api_key: string; project_id: string; host?: string },
): Promise<void> {
  const configJson = JSON.stringify(posthogConfig);
  await execute(`UPDATE custom_tools SET config_json = $1 WHERE name = 'posthog-read'`, [configJson]);
  logger.info('PostHog config updated');
}
