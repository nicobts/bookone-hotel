variable "project_id" {
  type        = string
  description = "The GCP project for this environment."
}

variable "environment" {
  type        = string
  description = "staging or prod."
  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be staging or prod."
  }
}

variable "region" {
  type        = string
  description = "An EU region (D9: guest data and compute stay in the EU)."
  default     = "europe-west8"
  validation {
    condition     = startswith(var.region, "europe-")
    error_message = "Only EU regions (D9)."
  }
}

variable "image_tag" {
  type        = string
  description = "The signed image tag to deploy, the same for all three services."
}

variable "secret_names" {
  type        = set(string)
  description = "Secret Manager secrets to create. Values are added out of band, never in state."
  default = [
    "DATABASE_URL",
    "WORKER_INTERNAL_TOKEN",
    "PAYMENT_WEBHOOK_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "STAY_TOKEN_SECRET",
    "OPENROUTER_API_KEY",
    "ADMIN_SUPABASE_ANON_KEY",
    "TWILIO_AUTH_TOKEN",
  ]
}

variable "api_env" {
  type        = map(string)
  description = "Non-secret environment for apps/api."
  default     = {}
}

variable "worker_env" {
  type        = map(string)
  description = "Non-secret environment for apps/worker."
  default     = {}
}

variable "admin_env" {
  type        = map(string)
  description = "Non-secret environment for apps/admin (includes ADMIN_SUPABASE_URL)."
  default     = {}
}
