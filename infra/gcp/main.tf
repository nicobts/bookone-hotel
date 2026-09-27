locals {
  name     = "bookone-${var.environment}"
  registry = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"

  # Which secrets each service reads. Least privilege: a service gets an
  # accessor binding only on the secrets listed here.
  secrets = {
    api    = ["DATABASE_URL", "WORKER_INTERNAL_TOKEN", "PAYMENT_WEBHOOK_SECRET"]
    worker = ["DATABASE_URL", "PAYMENT_WEBHOOK_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "STAY_TOKEN_SECRET", "OPENROUTER_API_KEY"]
    admin  = ["DATABASE_URL", "ADMIN_SUPABASE_ANON_KEY"]
  }

  service_secret_pairs = flatten([
    for service, names in local.secrets : [for name in names : { service = service, secret = name }]
  ])
}

resource "google_artifact_registry_repository" "images" {
  repository_id = local.name
  location      = var.region
  format        = "DOCKER"
  description   = "BookOne service images (signed in CI, ADR-032 item 8)."
}

resource "google_secret_manager_secret" "secret" {
  for_each  = var.secret_names
  secret_id = "${local.name}-${each.value}"

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

resource "google_service_account" "service" {
  for_each     = local.secrets
  account_id   = "${local.name}-${each.key}"
  display_name = "BookOne ${each.key} (${var.environment})"
}

resource "google_secret_manager_secret_iam_member" "access" {
  for_each  = { for pair in local.service_secret_pairs : "${pair.service}/${pair.secret}" => pair }
  secret_id = google_secret_manager_secret.secret[each.value.secret].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.service[each.value.service].email}"
}

# apps/api: the only service with public ingress, and only for webhooks and
# health. Cloud Armor in front (ADR-033) arrives with the load balancer.
resource "google_cloud_run_v2_service" "api" {
  name     = "${local.name}-api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.service["api"].email
    scaling {
      min_instance_count = 1
      max_instance_count = 3
    }
    containers {
      image = "${local.registry}/api:${var.image_tag}"
      ports {
        container_port = 8787
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "TRUST_PROXY"
        value = "true"
      }
      dynamic "env" {
        for_each = var.api_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = toset(local.secrets.api)
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.secret[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
}

# apps/worker: a persistent process (ADR-003's constraint) — one always-on
# instance with CPU always allocated, no inbound traffic.
resource "google_cloud_run_v2_service" "worker" {
  name     = "${local.name}-worker"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    service_account = google_service_account.service["worker"].email
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }
    containers {
      image = "${local.registry}/worker:${var.image_tag}"
      resources {
        cpu_idle = false
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      dynamic "env" {
        for_each = var.worker_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = toset(local.secrets.worker)
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.secret[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
}

# apps/admin: internal ingress only; staff reach it through identity-aware
# access (ADR-031). No allUsers invoker binding exists for it, on purpose.
resource "google_cloud_run_v2_service" "admin" {
  name     = "${local.name}-admin"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    service_account = google_service_account.service["admin"].email
    containers {
      image = "${local.registry}/admin:${var.image_tag}"
      ports {
        container_port = 3100
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      dynamic "env" {
        for_each = var.admin_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = toset(local.secrets.admin)
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.secret[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
}

# Payment providers must reach the webhook without credentials; the signature
# is the authentication (apps/api/src/app.ts).
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
