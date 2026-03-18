#!/bin/bash
#
# init-letsencrypt.sh — Bootstrap SSL certificates for TinyHands
#
# Creates a dummy self-signed cert so Nginx can start, then requests a real
# certificate from Let's Encrypt via certbot, and reloads Nginx.
#
# Usage:
#   ./deploy/init-letsencrypt.sh <domain> <email>
#   OAUTH_DOMAIN=example.com LETSENCRYPT_EMAIL=you@example.com ./deploy/init-letsencrypt.sh
#

set -euo pipefail

DOMAIN="${1:-${OAUTH_DOMAIN:-}}"
EMAIL="${2:-${LETSENCRYPT_EMAIL:-}}"

if [ -z "$DOMAIN" ]; then
  echo "Error: domain is required."
  echo "Usage: $0 <domain> <email>"
  echo "  or set OAUTH_DOMAIN and LETSENCRYPT_EMAIL env vars"
  exit 1
fi

if [ -z "$EMAIL" ]; then
  echo "Error: email is required (for Let's Encrypt notifications)."
  echo "Usage: $0 <domain> <email>"
  echo "  or set OAUTH_DOMAIN and LETSENCRYPT_EMAIL env vars"
  exit 1
fi

CERT_DIR="./certbot/conf/live/$DOMAIN"

echo "==> Setting up SSL for $DOMAIN (email: $EMAIL)"

# Step 1: Create dummy certificate so Nginx can start
echo "==> Creating dummy certificate..."
mkdir -p "$CERT_DIR"
docker compose run --rm --entrypoint "\
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
    -out /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
    -subj '/CN=$DOMAIN'" certbot

echo "==> Starting Nginx..."
docker compose up -d nginx

# Step 2: Delete dummy certificate
echo "==> Removing dummy certificate..."
docker compose run --rm --entrypoint "\
  rm -rf /etc/letsencrypt/live/$DOMAIN && \
  rm -rf /etc/letsencrypt/archive/$DOMAIN && \
  rm -rf /etc/letsencrypt/renewal/$DOMAIN.conf" certbot

# Step 3: Request real certificate from Let's Encrypt
echo "==> Requesting certificate from Let's Encrypt..."
docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/lib/letsencrypt \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

# Step 4: Reload Nginx to pick up real certificate
echo "==> Reloading Nginx..."
docker compose exec nginx nginx -s reload

echo "==> SSL setup complete for $DOMAIN"
echo "    Your site is now available at https://$DOMAIN"
echo "    Certificates will auto-renew via the certbot service."
