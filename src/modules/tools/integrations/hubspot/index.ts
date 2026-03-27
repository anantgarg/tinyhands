import { registerCustomTool, getCustomTool } from '../../index';
import { execute } from '../../../../db';
import { logger } from '../../../../utils/logger';
import type { ToolManifest } from '../manifest';

// ── Schemas & Code ──
// Kept as string constants — they run inside Docker, not in the host process.

const READ_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Read-only access to HubSpot CRM: search contacts, deals, companies; get details; list pipelines.',
  properties: {
    action: {
      type: 'string',
      enum: ['search_contacts', 'filter_contacts', 'search_deals', 'get_contact', 'get_deal', 'list_pipelines', 'get_company', 'search_companies', 'get_contact_activity'],
      description: 'The HubSpot action to perform. Use filter_contacts to find contacts by property filters (e.g. blank lead status). Use get_contact_activity to view engagements, notes, tasks, and analytics for a contact.',
    },
    query: { type: 'string', description: 'Search query text (for search_contacts, search_deals, search_companies)' },
    filters: { type: 'array', items: { type: 'object', properties: { propertyName: { type: 'string' }, operator: { type: 'string', description: 'HubSpot filter operator: EQ, NEQ, GT, LT, GTE, LTE, HAS_PROPERTY, NOT_HAS_PROPERTY, CONTAINS_TOKEN, NOT_CONTAINS_TOKEN' }, value: { type: 'string' } }, required: ['propertyName', 'operator'] }, description: 'Filters for filter_contacts. Use NOT_HAS_PROPERTY to find contacts where a property is blank/empty.' },
    contact_id: { type: 'string', description: 'Contact ID (for get_contact)' },
    deal_id: { type: 'string', description: 'Deal ID (for get_deal)' },
    company_id: { type: 'string', description: 'Company ID (for get_company)' },
    properties: { type: 'array', items: { type: 'string' }, description: 'Properties to include in response' },
    limit: { type: 'number', description: 'Max results (default 10, max 100)' },
    after: { type: 'string', description: 'Pagination cursor for next page' },
  },
  required: ['action'],
});

const READ_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'hubspot-read.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const token = config.access_token;
if (!token) {
  console.log(JSON.stringify({ error: 'HubSpot access token not configured. Admin must set access_token in tool config.' }));
  process.exit(0);
}

function hubspotRequest(reqPath, method, body) {
  return new Promise(function(resolve, reject) {
    var payload = body ? JSON.stringify(body) : null;
    var options = {
      hostname: 'api.hubapi.com',
      path: reqPath,
      method: method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
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

async function main() {
  var a = input.action;
  var lim = Math.min(input.limit || 10, 100);
  var props = input.properties || [];
  var result;

  switch (a) {
    case 'search_contacts': {
      if (!input.query) { result = { error: 'query is required for search_contacts' }; break; }
      // Detect misuse: agent trying to find blank/empty/unset properties via text search
      var q = input.query.toLowerCase();
      if (q.match(/blank|empty|unset|not set|no lead.?status|missing|null|without|where.*is.*blank/)) {
        result = { error: 'WRONG ACTION: search_contacts does full-text search — it CANNOT filter by blank/empty properties. Use filter_contacts with operator NOT_HAS_PROPERTY instead. Example: {"action":"filter_contacts","filters":[{"propertyName":"hs_lead_status","operator":"NOT_HAS_PROPERTY"}]}' };
        break;
      }
      var body = { query: input.query, limit: lim, properties: props.length > 0 ? props : ['email', 'firstname', 'lastname', 'phone', 'company'] };
      if (input.after) body.after = input.after;
      result = await hubspotRequest('/crm/v3/objects/contacts/search', 'POST', body);
      break;
    }
    case 'filter_contacts': {
      if (!input.filters || !Array.isArray(input.filters) || input.filters.length === 0) {
        result = { error: 'filters array is required for filter_contacts. Example: [{"propertyName":"hs_lead_status","operator":"NOT_HAS_PROPERTY"}]' };
        break;
      }
      var filterBody = {
        filterGroups: [{ filters: input.filters }],
        limit: lim,
        properties: props.length > 0 ? props : ['email', 'firstname', 'lastname', 'phone', 'company', 'hs_lead_status', 'createdate'],
        sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }]
      };
      if (input.after) filterBody.after = input.after;
      result = await hubspotRequest('/crm/v3/objects/contacts/search', 'POST', filterBody);
      break;
    }
    case 'search_deals': {
      if (!input.query) { result = { error: 'query is required for search_deals' }; break; }
      var body = { query: input.query, limit: lim, properties: props.length > 0 ? props : ['dealname', 'amount', 'dealstage', 'pipeline', 'closedate'] };
      if (input.after) body.after = input.after;
      result = await hubspotRequest('/crm/v3/objects/deals/search', 'POST', body);
      break;
    }
    case 'get_contact': {
      if (!input.contact_id) { result = { error: 'contact_id is required' }; break; }
      var qs = props.length > 0 ? '?properties=' + props.join(',') : '?properties=email,firstname,lastname,phone,company,lifecyclestage';
      result = await hubspotRequest('/crm/v3/objects/contacts/' + input.contact_id + qs);
      break;
    }
    case 'get_deal': {
      if (!input.deal_id) { result = { error: 'deal_id is required' }; break; }
      var qs = props.length > 0 ? '?properties=' + props.join(',') : '?properties=dealname,amount,dealstage,pipeline,closedate,hubspot_owner_id';
      result = await hubspotRequest('/crm/v3/objects/deals/' + input.deal_id + qs);
      break;
    }
    case 'list_pipelines': {
      result = await hubspotRequest('/crm/v3/pipelines/deals');
      break;
    }
    case 'get_company': {
      if (!input.company_id) { result = { error: 'company_id is required' }; break; }
      var qs = props.length > 0 ? '?properties=' + props.join(',') : '?properties=name,domain,industry,numberofemployees,annualrevenue';
      result = await hubspotRequest('/crm/v3/objects/companies/' + input.company_id + qs);
      break;
    }
    case 'search_companies': {
      if (!input.query) { result = { error: 'query is required for search_companies' }; break; }
      var body = { query: input.query, limit: lim, properties: props.length > 0 ? props : ['name', 'domain', 'industry', 'numberofemployees'] };
      if (input.after) body.after = input.after;
      result = await hubspotRequest('/crm/v3/objects/companies/search', 'POST', body);
      break;
    }
    case 'get_contact_activity': {
      if (!input.contact_id) { result = { error: 'contact_id is required for get_contact_activity' }; break; }
      // Get engagements associated with this contact
      var engResult = await hubspotRequest('/crm/v3/objects/contacts/' + input.contact_id + '/associations/engagements');
      if (engResult.status >= 400) {
        // Fallback: search for recent engagements with broader properties
        var noteResult = await hubspotRequest('/crm/v3/objects/contacts/' + input.contact_id + '/associations/notes');
        var taskResult = await hubspotRequest('/crm/v3/objects/contacts/' + input.contact_id + '/associations/tasks');
        result = {
          notes: noteResult.data,
          tasks: taskResult.data,
          hint: 'Enable crm.objects.contacts.read and timeline scope for full activity data'
        };
        break;
      }
      // Fetch details for each engagement
      var engagements = (engResult.data && engResult.data.results) || [];
      var details = [];
      for (var i = 0; i < Math.min(engagements.length, 20); i++) {
        var engId = engagements[i].toObjectId || engagements[i].id;
        if (!engId) continue;
        var detail = await hubspotRequest('/crm/v3/objects/engagements/' + engId + '?properties=hs_engagement_type,hs_timestamp,hs_body_preview,hs_title');
        if (detail.status < 400) details.push(detail.data);
      }
      // Also get form submissions via contact properties
      var contactProps = await hubspotRequest('/crm/v3/objects/contacts/' + input.contact_id + '?properties=hs_analytics_num_page_views,hs_analytics_num_visits,hs_analytics_source,hs_latest_source,first_conversion_event_name,first_conversion_date,recent_conversion_event_name,recent_conversion_date,num_conversion_events,hs_lifecyclestage_lead_date');
      result = {
        engagements: details,
        contact_analytics: contactProps.status < 400 ? contactProps.data : null,
        total_engagements: engagements.length
      };
      break;
    }
    default:
      result = { error: 'Unknown action: ' + a + '. Valid: search_contacts, filter_contacts, search_deals, get_contact, get_deal, list_pipelines, get_company, search_companies, get_contact_activity' };
  }

  console.log(JSON.stringify(result));
}

main().catch(function(err) {
  console.log(JSON.stringify({ error: err.message }));
});`;

const WRITE_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Create and update HubSpot CRM records: contacts, deals, companies, tasks, and notes. No destructive actions (no delete).',
  properties: {
    action: {
      type: 'string',
      enum: ['create_contact', 'update_contact', 'create_deal', 'update_deal', 'create_task', 'add_note', 'create_company'],
      description: 'The HubSpot write action to perform',
    },
    contact_id: { type: 'string', description: 'Contact ID (for update_contact, or to associate with note/task)' },
    deal_id: { type: 'string', description: 'Deal ID (for update_deal, or to associate with note/task)' },
    company_id: { type: 'string', description: 'Company ID (for associating)' },
    properties: {
      type: 'object',
      description: 'Property key-value pairs for create/update. Contacts: email, firstname, lastname, phone, company. Deals: dealname, amount, dealstage, pipeline, closedate. Companies: name, domain, industry.',
    },
    pipeline_id: { type: 'string', description: 'Pipeline ID (for create_deal)' },
    stage_id: { type: 'string', description: 'Deal stage ID (for create_deal)' },
    note_body: { type: 'string', description: 'Note content (for add_note)' },
    task_subject: { type: 'string', description: 'Task subject (for create_task)' },
    task_body: { type: 'string', description: 'Task description (for create_task)' },
    task_due_date: { type: 'string', description: 'Task due date in ISO format (for create_task)' },
  },
  required: ['action'],
});

const WRITE_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'hubspot-write.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const token = config.access_token;
if (!token) {
  console.log(JSON.stringify({ error: 'HubSpot access token not configured. Admin must set access_token in tool config.' }));
  process.exit(0);
}

function hubspotRequest(reqPath, method, body) {
  return new Promise(function(resolve, reject) {
    var payload = body ? JSON.stringify(body) : null;
    var options = {
      hostname: 'api.hubapi.com',
      path: reqPath,
      method: method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
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

async function associate(fromType, fromId, toType, toId) {
  var assocPath = '/crm/v4/objects/' + fromType + '/' + fromId + '/associations/' + toType + '/' + toId;
  return hubspotRequest(assocPath, 'PUT', [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 0 }]);
}

async function main() {
  var a = input.action;
  var result;

  switch (a) {
    case 'create_contact': {
      if (!input.properties) { result = { error: 'properties are required for create_contact' }; break; }
      result = await hubspotRequest('/crm/v3/objects/contacts', 'POST', { properties: input.properties });
      break;
    }
    case 'update_contact': {
      if (!input.contact_id || !input.properties) { result = { error: 'contact_id and properties are required' }; break; }
      result = await hubspotRequest('/crm/v3/objects/contacts/' + input.contact_id, 'PATCH', { properties: input.properties });
      break;
    }
    case 'create_deal': {
      if (!input.properties) { result = { error: 'properties are required for create_deal' }; break; }
      var dealProps = Object.assign({}, input.properties);
      if (input.pipeline_id) dealProps.pipeline = input.pipeline_id;
      if (input.stage_id) dealProps.dealstage = input.stage_id;
      result = await hubspotRequest('/crm/v3/objects/deals', 'POST', { properties: dealProps });
      if (result.status < 300 && result.data && result.data.id) {
        var dealId = result.data.id;
        if (input.contact_id) await associate('deals', dealId, 'contacts', input.contact_id);
        if (input.company_id) await associate('deals', dealId, 'companies', input.company_id);
      }
      break;
    }
    case 'update_deal': {
      if (!input.deal_id || !input.properties) { result = { error: 'deal_id and properties are required' }; break; }
      result = await hubspotRequest('/crm/v3/objects/deals/' + input.deal_id, 'PATCH', { properties: input.properties });
      break;
    }
    case 'create_task': {
      if (!input.task_subject) { result = { error: 'task_subject is required for create_task' }; break; }
      var taskProps = {
        hs_task_subject: input.task_subject,
        hs_task_body: input.task_body || '',
        hs_task_status: 'NOT_STARTED',
      };
      if (input.task_due_date) taskProps.hs_task_due_date = input.task_due_date;
      result = await hubspotRequest('/crm/v3/objects/tasks', 'POST', { properties: taskProps });
      if (result.status < 300 && result.data && result.data.id) {
        var taskId = result.data.id;
        if (input.contact_id) await associate('tasks', taskId, 'contacts', input.contact_id);
        if (input.deal_id) await associate('tasks', taskId, 'deals', input.deal_id);
        if (input.company_id) await associate('tasks', taskId, 'companies', input.company_id);
      }
      break;
    }
    case 'add_note': {
      if (!input.note_body) { result = { error: 'note_body is required for add_note' }; break; }
      result = await hubspotRequest('/crm/v3/objects/notes', 'POST', {
        properties: { hs_note_body: input.note_body, hs_timestamp: new Date().toISOString() },
      });
      if (result.status < 300 && result.data && result.data.id) {
        var noteId = result.data.id;
        if (input.contact_id) await associate('notes', noteId, 'contacts', input.contact_id);
        if (input.deal_id) await associate('notes', noteId, 'deals', input.deal_id);
        if (input.company_id) await associate('notes', noteId, 'companies', input.company_id);
      }
      break;
    }
    case 'create_company': {
      if (!input.properties) { result = { error: 'properties are required for create_company' }; break; }
      result = await hubspotRequest('/crm/v3/objects/companies', 'POST', { properties: input.properties });
      break;
    }
    default:
      result = { error: 'Unknown action: ' + a + '. Valid: create_contact, update_contact, create_deal, update_deal, create_task, add_note, create_company' };
  }

  console.log(JSON.stringify(result));
}

main().catch(function(err) {
  console.log(JSON.stringify({ error: err.message }));
});`;

// ── Manifest ──

export const manifest: ToolManifest = {
  id: 'hubspot',
  label: 'HubSpot',
  icon: ':orange_book:',
  description: 'Search contacts/deals/companies, manage CRM records, create tasks and notes.',
  configKeys: ['access_token'],
  setupGuide: '*How to get your token:*\n1. Go to *Settings > Integrations > Private Apps*\n2. Click *Create a private app*, give it a name\n3. Under *Scopes*, enable:\n    `crm.objects.contacts.read` · `crm.objects.contacts.write`\n    `crm.objects.deals.read` · `crm.objects.deals.write`\n    `crm.objects.companies.read` · `crm.objects.companies.write`\n4. Click *Create app*, then copy the access token',
  configPlaceholders: {
    access_token: 'Paste Private App access token here',
  },
  connectionModel: 'hybrid',
  tools: [
    { name: 'hubspot-read', schema: READ_SCHEMA, code: READ_CODE, accessLevel: 'read-only', displayName: 'Checking HubSpot' },
    { name: 'hubspot-write', schema: WRITE_SCHEMA, code: WRITE_CODE, accessLevel: 'read-write', displayName: 'Updating HubSpot' },
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
