# Changelog

## [2025-03-17] Host Header Fix for Custom Domains

### Added
- New `origin-request-edge` Lambda function to handle Host header modification
- Better code organization with `lambda-functions` directory structure:
  - `domain-mapper-edge/index.mjs`: Handles viewer-request events
  - `origin-request-edge/index.mjs`: Handles origin-request events

### Changed
- Modified `domain-mapper-edge` function to:
  - Run on `viewer-request` instead of `origin-request`
  - Store target host in `x-custom-host` header
  - Keep workspace ID path modification
- Updated CloudFront distribution to:
  - Use both Lambda functions in sequence
  - Keep using origin request policy that excludes viewer's Host header

### Removed
- Removed direct Host header modification from viewer-request
- Removed redundant CloudFront Function

### Technical Details
- CloudFront Distribution ID: `E6TV8E316UM9F`
- CloudFront Domain: `d3n96herxxe2fs.cloudfront.net`
- Amplify App Domain: `master.d1ul468muq9dvs.amplifyapp.com`
- Custom Domain Pattern: `*.devopsify.shop`

### Architecture Notes
1. Request Flow:
   - Browser requests `gallery.devopsify.shop`
   - `domain-mapper-edge` (viewer-request):
     - Looks up workspace ID in DynamoDB
     - Modifies path to include workspace ID
     - Stores `master.d1ul468muq9dvs.amplifyapp.com` in `x-custom-host`
   - `origin-request-edge` (origin-request):
     - Sets Host header from `x-custom-host`
     - Removes `x-custom-host` header
   - Request reaches Amplify with correct Host and path

2. Key Decisions:
   - Using two Lambda@Edge functions due to CloudFront event restrictions
   - Viewer-request can't modify Host header (read-only)
   - Origin-request needed for Host header modification
   - Can't use CloudFront Functions as they can't modify Host header

### DNS Configuration
- CNAME records should point to `d3n96herxxe2fs.cloudfront.net` (without master prefix)
- TTL: 1 Hour
- CloudFront distribution accepts `*.devopsify.shop`
- Lambda@Edge handles adding `master.` prefix when needed
