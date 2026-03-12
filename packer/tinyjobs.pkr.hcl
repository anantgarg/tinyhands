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

variable "tinyjobs_version" {
  type    = string
  default = "latest"
}

source "digitalocean" "tinyjobs" {
  api_token    = var.do_api_token
  image        = "ubuntu-22-04-x64"
  region       = "nyc3"
  size         = "s-4vcpu-8gb"
  ssh_username = "root"

  snapshot_name = "tinyjobs-${var.tinyjobs_version}-{{timestamp}}"
  snapshot_regions = [
    "nyc1", "nyc3", "sfo3", "ams3", "sgp1",
    "lon1", "fra1", "blr1", "tor1", "syd1"
  ]
}

build {
  sources = ["source.digitalocean.tinyjobs"]

  # Install system dependencies and TinyJobs
  provisioner "shell" {
    script = "scripts/provision.sh"
  }

  # MOTD welcome message
  provisioner "file" {
    source      = "files/99-tinyjobs-welcome"
    destination = "/etc/update-motd.d/99-tinyjobs-welcome"
  }

  # Interactive setup script
  provisioner "file" {
    source      = "files/tinyjobs-first-login.sh"
    destination = "/opt/tinyjobs-setup.sh"
  }

  provisioner "shell" {
    inline = [
      "chmod +x /etc/update-motd.d/99-tinyjobs-welcome",
      "chmod +x /opt/tinyjobs-setup.sh"
    ]
  }

  # DO Marketplace cleanup
  provisioner "shell" {
    script = "scripts/cleanup.sh"
  }
}
