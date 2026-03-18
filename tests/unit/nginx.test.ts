import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const templatePath = path.resolve(__dirname, '../../nginx/default.conf.template');
const template = fs.readFileSync(templatePath, 'utf-8');

describe('Nginx Config Template', () => {
  it('should contain the OAUTH_DOMAIN placeholder for server_name', () => {
    expect(template).toContain('server_name ${OAUTH_DOMAIN}');
  });

  it('should contain the OAUTH_DOMAIN placeholder for SSL cert paths', () => {
    expect(template).toContain('/etc/letsencrypt/live/${OAUTH_DOMAIN}/fullchain.pem');
    expect(template).toContain('/etc/letsencrypt/live/${OAUTH_DOMAIN}/privkey.pem');
  });

  it('should have proxy_pass to tinyhands service on port 3000', () => {
    expect(template).toContain('proxy_pass http://tinyhands:3000');
  });

  it('should have SSL configuration', () => {
    expect(template).toContain('listen 443 ssl');
    expect(template).toContain('ssl_certificate');
    expect(template).toContain('ssl_certificate_key');
    expect(template).toContain('ssl_protocols');
  });

  it('should have HTTP to HTTPS redirect', () => {
    expect(template).toContain('listen 80');
    expect(template).toContain('return 301 https://');
  });

  it('should have both HTTP and HTTPS server blocks', () => {
    const serverBlocks = template.match(/^server\s*\{/gm);
    expect(serverBlocks).toHaveLength(2);
  });

  it('should set proper proxy headers', () => {
    expect(template).toContain('proxy_set_header Host');
    expect(template).toContain('proxy_set_header X-Real-IP');
    expect(template).toContain('proxy_set_header X-Forwarded-For');
    expect(template).toContain('proxy_set_header X-Forwarded-Proto');
    expect(template).toContain('proxy_set_header Upgrade');
    expect(template).toContain('proxy_set_header Connection');
  });
});
