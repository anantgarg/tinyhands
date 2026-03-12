#!/bin/bash
set -euo pipefail

# DigitalOcean Marketplace image cleanup
# https://docs.digitalocean.com/products/marketplace/getting-started/submission-guidelines/

echo "=== Marketplace cleanup ==="

# Clean apt cache
apt-get -y autoremove
apt-get -y autoclean
apt-get -y clean

# Remove SSH keys (DO injects new ones on Droplet creation)
rm -f /root/.ssh/authorized_keys
rm -f /etc/ssh/ssh_host_*

# Clean logs
find /var/log -type f -exec truncate --size=0 {} \;
rm -f /var/log/*.gz /var/log/*.[0-9] /var/log/*-????????

# Clean temp files
rm -rf /tmp/* /var/tmp/*

# Clean bash history
> /root/.bash_history
unset HISTFILE

# Clean cloud-init (so it runs fresh on new Droplet)
cloud-init clean --logs 2>/dev/null || true

echo "=== Cleanup complete ==="
