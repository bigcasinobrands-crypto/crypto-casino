variable "region" {
  type    = string
  default = "us-east-1"
}

variable "name_prefix" {
  type        = string
  description = "Prefix for WAF WebACL name"
  default     = "casino"
}
