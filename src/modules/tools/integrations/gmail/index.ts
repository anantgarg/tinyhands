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
  description: 'Search and read Gmail emails.',
  properties: {
    action: {
      type: 'string',
      enum: ['search', 'read_email', 'list_labels'],
      description: 'The Gmail action to perform',
    },
    query: { type: 'string', description: 'Gmail search query (for search). Supports Gmail search operators like from:, to:, subject:, has:attachment, newer_than:, older_than:, etc.' },
    message_id: { type: 'string', description: 'Message ID (for read_email)' },
    max_results: { type: 'number', description: 'Max results to return (default 10, max 50)' },
    label_ids: { type: 'array', items: { type: 'string' }, description: 'Filter by label IDs (e.g. ["INBOX", "UNREAD"])' },
  },
  required: ['action'],
});

const READ_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'gmail-read.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const token = config.access_token;
if (!token) {
  console.log(JSON.stringify({ error: 'Gmail not connected. Go to Connections to connect your Google account.' }));
  process.exit(0);
}

${GOOGLE_REQUEST_FN}

function decodeBase64Url(str) {
  if (!str) return '';
  var base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function getHeader(headers, name) {
  if (!headers) return '';
  var h = headers.find(function(h) { return h.name.toLowerCase() === name.toLowerCase(); });
  return h ? h.value : '';
}

function extractBody(payload) {
  if (!payload) return '';
  // Simple body
  if (payload.body && payload.body.data) {
    return decodeBase64Url(payload.body.data);
  }
  // Multipart - prefer text/plain, fallback to text/html
  if (payload.parts) {
    var textPart = null;
    var htmlPart = null;
    for (var part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body && part.body.data) {
        textPart = decodeBase64Url(part.body.data);
      } else if (part.mimeType === 'text/html' && part.body && part.body.data) {
        htmlPart = decodeBase64Url(part.body.data);
      } else if (part.parts) {
        var nested = extractBody(part);
        if (nested) textPart = textPart || nested;
      }
    }
    if (textPart) return textPart;
    if (htmlPart) {
      // Strip HTML tags for readability
      return htmlPart.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\\n\\s*\\n/g, '\\n');
    }
  }
  return '';
}

async function run() {
  var action = input.action;

  switch (action) {
    case 'search': {
      var maxResults = Math.min(input.max_results || 10, 50);
      var url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=' + maxResults;
      if (input.query) url += '&q=' + encodeURIComponent(input.query);
      if (input.label_ids && input.label_ids.length > 0) {
        for (var lid of input.label_ids) {
          url += '&labelIds=' + encodeURIComponent(lid);
        }
      }
      var res = await googleRequest(url, 'GET');
      if (res.status !== 200) return { error: 'Gmail API error', status: res.status, details: res.data };
      var messages = res.data.messages || [];
      if (messages.length === 0) return { messages: [], total: 0 };
      // Fetch metadata for each message (batch up to maxResults)
      var results = [];
      for (var msg of messages) {
        var detail = await googleRequest(
          'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + msg.id + '?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date',
          'GET'
        );
        if (detail.status === 200) {
          results.push({
            id: detail.data.id,
            thread_id: detail.data.threadId,
            snippet: detail.data.snippet,
            from: getHeader(detail.data.payload && detail.data.payload.headers, 'From'),
            to: getHeader(detail.data.payload && detail.data.payload.headers, 'To'),
            subject: getHeader(detail.data.payload && detail.data.payload.headers, 'Subject'),
            date: getHeader(detail.data.payload && detail.data.payload.headers, 'Date'),
            labels: detail.data.labelIds,
          });
        }
      }
      return { messages: results, total: res.data.resultSizeEstimate || results.length };
    }
    case 'read_email': {
      if (!input.message_id) return { error: 'message_id is required' };
      var res2 = await googleRequest(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + input.message_id + '?format=full',
        'GET'
      );
      if (res2.status !== 200) return { error: 'Gmail API error', status: res2.status, details: res2.data };
      var headers = res2.data.payload && res2.data.payload.headers;
      var body = extractBody(res2.data.payload);
      var attachments = [];
      if (res2.data.payload && res2.data.payload.parts) {
        for (var part of res2.data.payload.parts) {
          if (part.filename && part.filename.length > 0) {
            attachments.push({ filename: part.filename, mime_type: part.mimeType, size: part.body && part.body.size });
          }
        }
      }
      return {
        id: res2.data.id,
        thread_id: res2.data.threadId,
        from: getHeader(headers, 'From'),
        to: getHeader(headers, 'To'),
        cc: getHeader(headers, 'Cc'),
        subject: getHeader(headers, 'Subject'),
        date: getHeader(headers, 'Date'),
        labels: res2.data.labelIds,
        body: body.slice(0, 50000),
        attachments: attachments,
      };
    }
    case 'list_labels': {
      var res3 = await googleRequest(
        'https://gmail.googleapis.com/gmail/v1/users/me/labels',
        'GET'
      );
      if (res3.status !== 200) return { error: 'Gmail API error', status: res3.status, details: res3.data };
      return { labels: (res3.data.labels || []).map(function(l) { return { id: l.id, name: l.name, type: l.type }; }) };
    }
    default:
      return { error: 'Unknown action: ' + action + '. Use search, read_email, or list_labels.' };
  }
}
run().then(function(r) { console.log(JSON.stringify(r)); }).catch(function(e) { console.log(JSON.stringify({ error: e.message })); });
`;

const WRITE_SCHEMA = JSON.stringify({
  type: 'object',
  description: 'Send and reply to Gmail emails.',
  properties: {
    action: {
      type: 'string',
      enum: ['send_email', 'reply_email'],
      description: 'The write action to perform',
    },
    to: { type: 'string', description: 'Recipient email address (for send_email)' },
    cc: { type: 'string', description: 'CC email addresses, comma-separated (optional)' },
    bcc: { type: 'string', description: 'BCC email addresses, comma-separated (optional)' },
    subject: { type: 'string', description: 'Email subject (for send_email)' },
    body: { type: 'string', description: 'Email body text' },
    message_id: { type: 'string', description: 'Original message ID to reply to (for reply_email)' },
    thread_id: { type: 'string', description: 'Thread ID to keep reply in same thread (for reply_email)' },
  },
  required: ['action'],
});

const WRITE_CODE = `const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'gmail-write.config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const token = config.access_token;
if (!token) {
  console.log(JSON.stringify({ error: 'Gmail not connected. Go to Connections to connect your Google account.' }));
  process.exit(0);
}

${GOOGLE_REQUEST_FN}

function getHeader(headers, name) {
  if (!headers) return '';
  var h = headers.find(function(h) { return h.name.toLowerCase() === name.toLowerCase(); });
  return h ? h.value : '';
}

function encodeBase64Url(str) {
  return Buffer.from(str).toString('base64').replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
}

function buildRawEmail(to, subject, body, cc, bcc, inReplyTo, references) {
  var lines = [];
  lines.push('To: ' + to);
  if (cc) lines.push('Cc: ' + cc);
  if (bcc) lines.push('Bcc: ' + bcc);
  lines.push('Subject: ' + subject);
  if (inReplyTo) {
    lines.push('In-Reply-To: ' + inReplyTo);
    lines.push('References: ' + (references || inReplyTo));
  }
  lines.push('Content-Type: text/plain; charset=utf-8');
  lines.push('');
  lines.push(body);
  return encodeBase64Url(lines.join('\\r\\n'));
}

async function run() {
  var action = input.action;

  switch (action) {
    case 'send_email': {
      if (!input.to || !input.subject || !input.body) return { error: 'to, subject, and body are required' };
      var raw = buildRawEmail(input.to, input.subject, input.body, input.cc, input.bcc);
      var res = await googleRequest(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        'POST',
        { raw: raw }
      );
      if (res.status !== 200) return { error: 'Gmail API error', status: res.status, details: res.data };
      return { message_id: res.data.id, thread_id: res.data.threadId, labels: res.data.labelIds };
    }
    case 'reply_email': {
      if (!input.message_id || !input.body) return { error: 'message_id and body are required' };
      // Get original message to extract headers
      var original = await googleRequest(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + input.message_id + '?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References',
        'GET'
      );
      if (original.status !== 200) return { error: 'Gmail API error', status: original.status, details: original.data };
      var headers = original.data.payload && original.data.payload.headers;
      var replyTo = getHeader(headers, 'From');
      var originalSubject = getHeader(headers, 'Subject');
      var messageIdHeader = getHeader(headers, 'Message-ID');
      var references = getHeader(headers, 'References');
      var subject = originalSubject.startsWith('Re: ') ? originalSubject : 'Re: ' + originalSubject;
      var raw = buildRawEmail(
        replyTo, subject, input.body, input.cc, input.bcc,
        messageIdHeader, references
      );
      var sendBody = { raw: raw };
      if (input.thread_id || original.data.threadId) {
        sendBody.threadId = input.thread_id || original.data.threadId;
      }
      var res2 = await googleRequest(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        'POST',
        sendBody
      );
      if (res2.status !== 200) return { error: 'Gmail API error', status: res2.status, details: res2.data };
      return { message_id: res2.data.id, thread_id: res2.data.threadId, labels: res2.data.labelIds };
    }
    default:
      return { error: 'Unknown action: ' + action + '. Use send_email or reply_email.' };
  }
}
run().then(function(r) { console.log(JSON.stringify(r)); }).catch(function(e) { console.log(JSON.stringify({ error: e.message })); });
`;

// ── Manifest ──

export const manifest: ToolManifest = {
  id: 'gmail',
  label: 'Gmail',
  icon: ':email:',
  description: 'Read and send emails.',
  configKeys: ['access_token'],
  setupGuide: 'Connect your Google account via OAuth from the Connections page. Go to Connections > Add Connection > Google, then authorize access. Your email will be accessible once connected.',
  configPlaceholders: {
    access_token: 'Connected via OAuth',
  },
  tools: [
    { name: 'gmail-read', schema: READ_SCHEMA, code: READ_CODE, accessLevel: 'read-only', displayName: 'Reading Gmail' },
    { name: 'gmail-write', schema: WRITE_SCHEMA, code: WRITE_CODE, accessLevel: 'read-write', displayName: 'Sending Email' },
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
