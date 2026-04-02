import { registerCustomTool, getCustomTool } from '../../index';
import { execute } from '../../../../db';
import { logger } from '../../../../utils/logger';
import type { ToolManifest } from '../manifest';

// ── Schemas ──

const READ_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Read-only access to Chargebee: search customers, subscriptions, invoices; get details; list plans, coupons, and items.',
  properties: {
    action: {
      type: 'string',
      enum: [
        'list_customers', 'get_customer', 'search_customers',
        'list_subscriptions', 'get_subscription',
        'list_invoices', 'get_invoice',
        'list_plans', 'list_item_prices',
        'list_coupons',
      ],
      description: 'The Chargebee action to perform',
    },
    customer_id: {
      type: 'string',
      description: 'Customer ID (for get_customer, or to filter subscriptions/invoices)',
    },
    subscription_id: {
      type: 'string',
      description: 'Subscription ID (for get_subscription)',
    },
    invoice_id: {
      type: 'string',
      description: 'Invoice ID (for get_invoice)',
    },
    query: {
      type: 'string',
      description: 'Search query (email, name, or ID) for search_customers',
    },
    status: {
      type: 'string',
      enum: ['active', 'cancelled', 'non_renewing', 'future', 'in_trial', 'paused'],
      description: 'Filter by subscription status (for list_subscriptions)',
    },
    limit: {
      type: 'number',
      description: 'Max results (default 10, max 100)',
    },
    offset: {
      type: 'string',
      description: 'Pagination offset token (from next_offset in previous response)',
    },
    sort_by: {
      type: 'string',
      enum: ['created_at', 'updated_at'],
      description: 'Sort field (default created_at)',
    },
    sort_order: {
      type: 'string',
      enum: ['asc', 'desc'],
      description: 'Sort order (default desc)',
    },
  },
  required: ['action'],
});

const READ_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'chargebee-read.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const apiKey = config.api_key;
const site = config.site;
if (!apiKey || !site) {
  console.log(JSON.stringify({ error: 'Chargebee credentials not configured. Admin must set api_key and site in tool config.' }));
  process.exit(0);
}

var auth = Buffer.from(apiKey + ':').toString('base64');

function chargebeeRequest(reqPath) {
  return new Promise(function(resolve, reject) {
    var options = {
      hostname: site + '.chargebee.com',
      path: reqPath,
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Accept': 'application/json',
      },
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

function buildParams(params) {
  var parts = [];
  for (var k in params) {
    if (params[k] !== undefined && params[k] !== null) {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    }
  }
  return parts.length > 0 ? '?' + parts.join('&') : '';
}

async function main() {
  var a = input.action;
  var lim = Math.min(input.limit || 10, 100);
  var result;

  switch (a) {
    case 'list_customers': {
      var params = { limit: lim };
      if (input.offset) params.offset = input.offset;
      if (input.sort_by) params['sort_by[' + input.sort_by + ']'] = input.sort_order || 'desc';
      result = await chargebeeRequest('/api/v2/customers' + buildParams(params));
      break;
    }
    case 'get_customer': {
      if (!input.customer_id) { result = { error: 'customer_id is required' }; break; }
      result = await chargebeeRequest('/api/v2/customers/' + encodeURIComponent(input.customer_id));
      break;
    }
    case 'search_customers': {
      if (!input.query) { result = { error: 'query is required for search_customers' }; break; }
      var params = { limit: lim };
      if (input.offset) params.offset = input.offset;
      var q = input.query;
      if (q.indexOf('@') !== -1) {
        params['email[is]'] = q;
      } else {
        params['first_name[starts_with]'] = q;
      }
      result = await chargebeeRequest('/api/v2/customers' + buildParams(params));
      break;
    }
    case 'list_subscriptions': {
      var params = { limit: lim };
      if (input.customer_id) params['customer_id[is]'] = input.customer_id;
      if (input.status) params['status[is]'] = input.status;
      if (input.offset) params.offset = input.offset;
      if (input.sort_by) params['sort_by[' + input.sort_by + ']'] = input.sort_order || 'desc';
      result = await chargebeeRequest('/api/v2/subscriptions' + buildParams(params));
      break;
    }
    case 'get_subscription': {
      if (!input.subscription_id) { result = { error: 'subscription_id is required' }; break; }
      result = await chargebeeRequest('/api/v2/subscriptions/' + encodeURIComponent(input.subscription_id));
      break;
    }
    case 'list_invoices': {
      var params = { limit: lim };
      if (input.customer_id) params['customer_id[is]'] = input.customer_id;
      if (input.offset) params.offset = input.offset;
      if (input.sort_by) params['sort_by[' + input.sort_by + ']'] = input.sort_order || 'desc';
      result = await chargebeeRequest('/api/v2/invoices' + buildParams(params));
      break;
    }
    case 'get_invoice': {
      if (!input.invoice_id) { result = { error: 'invoice_id is required' }; break; }
      result = await chargebeeRequest('/api/v2/invoices/' + encodeURIComponent(input.invoice_id));
      break;
    }
    case 'list_plans': {
      var params = { limit: lim };
      if (input.offset) params.offset = input.offset;
      result = await chargebeeRequest('/api/v2/plans' + buildParams(params));
      break;
    }
    case 'list_item_prices': {
      var params = { limit: lim };
      if (input.offset) params.offset = input.offset;
      result = await chargebeeRequest('/api/v2/item_prices' + buildParams(params));
      break;
    }
    case 'list_coupons': {
      var params = { limit: lim };
      if (input.offset) params.offset = input.offset;
      result = await chargebeeRequest('/api/v2/coupons' + buildParams(params));
      break;
    }
    default:
      result = { error: 'Unknown action: ' + a + '. Valid: list_customers, get_customer, search_customers, list_subscriptions, get_subscription, list_invoices, get_invoice, list_plans, list_item_prices, list_coupons' };
  }

  console.log(JSON.stringify(result));
}

main().catch(function(err) {
  console.log(JSON.stringify({ error: err.message }));
});`;

const WRITE_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Create and update Chargebee records: customers, subscriptions, and one-time charges. No destructive actions (no delete/cancel).',
  properties: {
    action: {
      type: 'string',
      enum: [
        'create_customer', 'update_customer',
        'create_subscription', 'update_subscription',
        'cancel_subscription',
        'add_charge', 'apply_coupon',
      ],
      description: 'The Chargebee write action to perform',
    },
    customer_id: {
      type: 'string',
      description: 'Customer ID (for update_customer, create_subscription, add_charge)',
    },
    subscription_id: {
      type: 'string',
      description: 'Subscription ID (for update_subscription, cancel_subscription, apply_coupon)',
    },
    first_name: {
      type: 'string',
      description: 'Customer first name (for create_customer, update_customer)',
    },
    last_name: {
      type: 'string',
      description: 'Customer last name (for create_customer, update_customer)',
    },
    email: {
      type: 'string',
      description: 'Customer email (for create_customer, update_customer)',
    },
    company: {
      type: 'string',
      description: 'Customer company name (for create_customer, update_customer)',
    },
    phone: {
      type: 'string',
      description: 'Customer phone (for create_customer, update_customer)',
    },
    plan_id: {
      type: 'string',
      description: 'Plan ID (for create_subscription, update_subscription)',
    },
    plan_quantity: {
      type: 'number',
      description: 'Plan quantity / seats (for create_subscription, update_subscription)',
    },
    coupon_id: {
      type: 'string',
      description: 'Coupon ID (for apply_coupon)',
    },
    amount: {
      type: 'number',
      description: 'Charge amount in cents (for add_charge)',
    },
    charge_description: {
      type: 'string',
      description: 'Description for the charge (for add_charge)',
    },
    end_of_term: {
      type: 'boolean',
      description: 'Whether to cancel at end of current term (for cancel_subscription, default true)',
    },
  },
  required: ['action'],
});

const WRITE_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'chargebee-write.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

var apiKey = config.api_key;
var site = config.site;
if (!apiKey || !site) {
  console.log(JSON.stringify({ error: 'Chargebee credentials not configured. Admin must set api_key and site in tool config.' }));
  process.exit(0);
}

var auth = Buffer.from(apiKey + ':').toString('base64');

function chargebeeRequest(reqPath, method, formParams) {
  return new Promise(function(resolve, reject) {
    var payload = null;
    if (formParams) {
      var parts = [];
      for (var k in formParams) {
        if (formParams[k] !== undefined && formParams[k] !== null) {
          parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(formParams[k]));
        }
      }
      payload = parts.join('&');
    }
    var options = {
      hostname: site + '.chargebee.com',
      path: reqPath,
      method: method || 'GET',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Accept': 'application/json',
      },
    };
    if (payload) {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }
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
  var result;

  switch (a) {
    case 'create_customer': {
      if (!input.email && !input.first_name) { result = { error: 'email or first_name is required for create_customer' }; break; }
      var params = {};
      if (input.first_name) params.first_name = input.first_name;
      if (input.last_name) params.last_name = input.last_name;
      if (input.email) params.email = input.email;
      if (input.company) params.company = input.company;
      if (input.phone) params.phone = input.phone;
      result = await chargebeeRequest('/api/v2/customers', 'POST', params);
      break;
    }
    case 'update_customer': {
      if (!input.customer_id) { result = { error: 'customer_id is required for update_customer' }; break; }
      var params = {};
      if (input.first_name) params.first_name = input.first_name;
      if (input.last_name) params.last_name = input.last_name;
      if (input.email) params.email = input.email;
      if (input.company) params.company = input.company;
      if (input.phone) params.phone = input.phone;
      result = await chargebeeRequest('/api/v2/customers/' + encodeURIComponent(input.customer_id), 'POST', params);
      break;
    }
    case 'create_subscription': {
      if (!input.plan_id) { result = { error: 'plan_id is required for create_subscription' }; break; }
      var params = { plan_id: input.plan_id };
      if (input.customer_id) params['customer[id]'] = input.customer_id;
      if (input.plan_quantity) params.plan_quantity = input.plan_quantity;
      result = await chargebeeRequest('/api/v2/subscriptions', 'POST', params);
      break;
    }
    case 'update_subscription': {
      if (!input.subscription_id) { result = { error: 'subscription_id is required for update_subscription' }; break; }
      var params = {};
      if (input.plan_id) params.plan_id = input.plan_id;
      if (input.plan_quantity) params.plan_quantity = input.plan_quantity;
      result = await chargebeeRequest('/api/v2/subscriptions/' + encodeURIComponent(input.subscription_id), 'POST', params);
      break;
    }
    case 'cancel_subscription': {
      if (!input.subscription_id) { result = { error: 'subscription_id is required for cancel_subscription' }; break; }
      var params = { end_of_term: input.end_of_term !== false };
      result = await chargebeeRequest('/api/v2/subscriptions/' + encodeURIComponent(input.subscription_id) + '/cancel', 'POST', params);
      break;
    }
    case 'add_charge': {
      if (!input.subscription_id || !input.amount) { result = { error: 'subscription_id and amount are required for add_charge' }; break; }
      var params = {
        amount: input.amount,
        description: input.charge_description || 'One-time charge',
      };
      result = await chargebeeRequest('/api/v2/subscriptions/' + encodeURIComponent(input.subscription_id) + '/charge_future_renewals', 'POST', params);
      break;
    }
    case 'apply_coupon': {
      if (!input.subscription_id || !input.coupon_id) { result = { error: 'subscription_id and coupon_id are required for apply_coupon' }; break; }
      var params = { coupon_ids: input.coupon_id };
      result = await chargebeeRequest('/api/v2/subscriptions/' + encodeURIComponent(input.subscription_id), 'POST', params);
      break;
    }
    default:
      result = { error: 'Unknown action: ' + a + '. Valid: create_customer, update_customer, create_subscription, update_subscription, cancel_subscription, add_charge, apply_coupon' };
  }

  console.log(JSON.stringify(result));
}

main().catch(function(err) {
  console.log(JSON.stringify({ error: err.message }));
});`;

// ── Manifest ──

export const manifest: ToolManifest = {
  id: 'chargebee',
  label: 'Chargebee',
  icon: ':credit_card:',
  description: 'Search customers, subscriptions, invoices; manage billing, apply coupons.',
  configKeys: ['api_key', 'site'],
  setupGuide: 'How to get your credentials:\n1. Log in to Chargebee and go to Settings > API Keys\n2. Click "Add API Key" and create a Full Access key\n3. Copy the API key\n4. Your site name is the subdomain from your-subdomain.chargebee.com',
  configPlaceholders: {
    api_key: 'live_xxxxxxxxxxxxxxxx',
    site: 'your-subdomain (from your-subdomain.chargebee.com)',
  },
  tools: [
    { name: 'chargebee-read', schema: READ_SCHEMA, code: READ_CODE, accessLevel: 'read-only', displayName: 'Checking Chargebee' },
    { name: 'chargebee-write', schema: WRITE_SCHEMA, code: WRITE_CODE, accessLevel: 'read-write', displayName: 'Updating Chargebee' },
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
