# Stub: wire API Gateway + WAFv2 in a real account.
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# Example placeholder (commented) — enable when ARNs are known:
#
# resource "aws_wafv2_web_acl" "api" {
#   name  = "${var.name_prefix}-api"
#   scope = "REGIONAL"
#   default_action { allow {} }
#   visibility_config {
#     cloudwatch_metrics_enabled = true
#     metric_name                = "${var.name_prefix}WAF"
#     sampled_requests_enabled   = true
#   }
#   rule {
#     name     = "AWSManagedRulesCommonRuleSet"
#     priority = 1
#     override_action { none {} }
#     statement {
#       managed_rule_group_statement {
#         name        = "AWSManagedRulesCommonRuleSet"
#         vendor_name = "AWS"
#       }
#     }
#     visibility_config {
#       cloudwatch_metrics_enabled = true
#       metric_name                = "CRS"
#       sampled_requests_enabled   = true
#     }
#   }
# }
