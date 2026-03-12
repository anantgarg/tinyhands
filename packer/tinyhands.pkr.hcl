packer {
  required_plugins {
    digitalocean = {
      version = ">= 1.1.0"
      source  = "github.com/digitalocean/digitalocean"
    }
  }
}

variable "do_api_token" {
  type      = string
  sensitive = true
}

variable "tinyhands_version" {
  type    = string
  default = "latest"
}

source "digitalocean" "tinyhands" {
  api_token    = var.do_api_token
  image        = "ubuntu-22-04-x64"
  region       = "nyc3"
  size         = "s-4vcpu-8gb"
  ssh_username = "root"

  snapshot_name = "tinyhands-${var.tinyhands_version}-{{timestamp}}"
  snapshot_regions = [
    "nyc1", "nyc3", "sfo3", "ams3", "sgp1",
    "lon1", "fra1", "blr1", "tor1", "syd1"
  ]
}

build {
  sources = ["source.digitalocean.tinyhands"]

  # Install system dependencies and Tiny Hands
  provisioner "shell" {
    script = "scripts/provision.sh"
  }

  # MOTD welcome message
  provisioner "file" {
    source      = "files/99-tinyhands-welcome"
    destination = "/etc/update-motd.d/99-tinyhands-welcome"
  }

  # Interactive setup script
  provisioner "file" {
    source      = "files/tinyhands-first-login.sh"
    destination = "/opt/tinyhands-setup.sh"
  }

  provisioner "shell" {
    inline = [
      "chmod +x /etc/update-motd.d/99-tinyhands-welcome",
      "chmod +x /opt/tinyhands-setup.sh"
    ]
  }

  # DO Marketplace cleanup
  provisioner "shell" {
    script = "scripts/cleanup.sh"
  }
}
