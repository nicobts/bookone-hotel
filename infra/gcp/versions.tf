# GCP target (ADR-033): the container set moves here at the first signed pilot
# or paying contract. Prepared now, applied then. OpenTofu >= 1.8; the HCL is
# also valid Terraform. Run from WSL only (ADR-032).

terraform {
  required_version = ">= 1.8"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # State in a GCS bucket in the same EU region, created by hand once:
  # backend "gcs" { bucket = "bookone-tfstate-<env>"  prefix = "gcp" }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
