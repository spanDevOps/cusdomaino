# VE.AI Custom Domain Infrastructure

This repository contains the infrastructure and configuration for VE.AI's custom domain feature, enabling workspaces to use their own domains.

## Components

1. **Lambda@Edge Function (`index.mjs`)**
   - Handles request routing for both VE.AI domains and custom domains
   - Routes requests to the appropriate workspace using path-based routing
   - Integrates with DynamoDB for domain-to-workspace mappings

2. **CloudFront Configuration (`cf-config.json`)**
   - Configures CloudFront distribution for custom domains
   - Associates Lambda@Edge function for request processing
   - Manages SSL/TLS certificates and domain aliases

3. **React Test App (`ve-ai-test-app/`)**
   - Test application for verifying custom domain functionality
   - Handles workspace-based routing
   - Displays workspace information and badges

## Architecture

- **DNS**: Custom domains use CNAME records pointing to CloudFront
- **Routing**: Path-based routing (`/workspace-id/path`) on a single Amplify app
- **Storage**: DynamoDB for domain-to-workspace mappings
- **SSL**: Managed by ACM through CloudFront

## Development

1. Update Lambda function:
   ```bash
   aws lambda update-function-code --function-name domain-mapper-edge --zip-file fileb://domain-mapper-edge-lambda.zip
   ```

2. Update CloudFront:
   ```bash
   aws cloudfront update-distribution --id <distribution-id> --distribution-config file://cf-config.json
   ```

## Testing

Test both domain types:
1. Custom domains: `https://gallery.devopsify.shop/dashboard`
2. VE.AI domains: `https://workspace-1.ve.ai/dashboard`
