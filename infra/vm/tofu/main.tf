# Phase 0 host (ADR-033): one EU VM running infra/vm/compose.yaml. Hetzner is
# shown; the existing OCI instance is the alternative, with the same shape —
# a firewall that opens only 80/443, and SSH over the tailnet, never public.
#
# OpenTofu >= 1.8 (the HCL is also valid Terraform). Run from WSL only
# (ADR-032):
#   tofu init && tofu plan -no-color

terraform {
  required_version = ">= 1.8"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.50"
    }
  }
}

variable "hcloud_token" {
  type      = string
  sensitive = true
}

variable "environment" {
  type    = string
  default = "demo"
}

variable "location" {
  type        = string
  description = "A Hetzner EU location (D9)."
  default     = "fsn1"
  validation {
    condition     = contains(["fsn1", "nbg1", "hel1"], var.location)
    error_message = "EU locations only (D9)."
  }
}

variable "server_type" {
  type    = string
  default = "cx32"
}

variable "tailscale_auth_key" {
  type        = string
  sensitive   = true
  description = "A one-off, tagged, pre-approved key. It lands in cloud-init user data, so it must be ephemeral-use."
}

provider "hcloud" {
  token = var.hcloud_token
}

resource "hcloud_firewall" "ingress" {
  name = "bookone-${var.environment}"

  # Webhooks and health only, via Caddy. No port 22: SSH is Tailscale SSH.
  dynamic "rule" {
    for_each = ["80", "443"]
    content {
      direction  = "in"
      protocol   = "tcp"
      port       = rule.value
      source_ips = ["0.0.0.0/0", "::/0"]
    }
  }

  # Tailscale's direct connections; everything else relays through DERP.
  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "41641"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_server" "host" {
  name         = "bookone-${var.environment}"
  image        = "debian-12"
  server_type  = var.server_type
  location     = var.location
  firewall_ids = [hcloud_firewall.ingress.id]
  backups      = true # ADR-033: nightly snapshots

  user_data = templatefile("${path.module}/cloud-init.yaml", {
    tailscale_auth_key = var.tailscale_auth_key
    hostname           = "bookone-${var.environment}"
  })

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }
}

output "ipv4" {
  value       = hcloud_server.host.ipv4_address
  description = "Point API_HOST's DNS record here; Caddy obtains the certificate."
}
