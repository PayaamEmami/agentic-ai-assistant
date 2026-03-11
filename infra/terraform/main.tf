terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket = "aaa-terraform-state"
    key    = "infra/terraform.tfstate"
    region = "us-east-1"
    # TODO: enable DynamoDB locking for production
  }
}

provider "aws" {
  region = var.aws_region
}

module "networking" {
  source      = "./modules/networking"
  project     = var.project
  environment = var.environment
}

module "database" {
  source             = "./modules/database"
  project            = var.project
  environment        = var.environment
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
  instance_class     = var.db_instance_class
  db_password        = var.db_password
}

module "cache" {
  source             = "./modules/cache"
  project            = var.project
  environment        = var.environment
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
  node_type          = var.redis_node_type
}

module "storage" {
  source      = "./modules/storage"
  project     = var.project
  environment = var.environment
}
