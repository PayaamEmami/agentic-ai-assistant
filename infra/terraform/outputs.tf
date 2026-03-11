output "vpc_id" {
  value = module.networking.vpc_id
}

output "db_endpoint" {
  value = module.database.endpoint
}

output "redis_endpoint" {
  value = module.cache.endpoint
}

output "s3_bucket" {
  value = module.storage.bucket_name
}
