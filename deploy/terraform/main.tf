# One small Kubernetes cluster on Google Cloud for forever-jukebox.
#   terraform apply    creates it (about 5-10 minutes)
#   terraform destroy  deletes it, which is what stops the billing

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

variable "project" {
  description = "Google Cloud project ID that holds the cluster"
  type        = string
}

provider "google" {
  project = var.project
}

resource "google_container_cluster" "jukebox" {
  name     = "jukebox"
  location = "us-central1-a" # one zone: Google's free management-fee credit covers a zonal cluster

  # One fixed machine and no autoscaling, so the bill cannot grow on its own.
  initial_node_count = 1

  node_config {
    machine_type = "e2-medium" # 2 shared vCPUs, 4 GB, amd64 (the image only runs on amd64)
    disk_size_gb = 30
    disk_type    = "pd-standard"
  }

  deletion_protection = false # without this, terraform destroy refuses to delete the cluster
}

output "connect" {
  description = "Run this to point kubectl at the cluster"
  value       = "gcloud container clusters get-credentials ${google_container_cluster.jukebox.name} --zone ${google_container_cluster.jukebox.location} --project ${var.project}"
}
