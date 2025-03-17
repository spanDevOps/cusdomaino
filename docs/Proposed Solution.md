# Custom Domain Implementation Proposal for VE.AI

## Overview
Implementing custom domain support similar to Pixieset's approach, allowing tenants to use their own domains (e.g., gallery.client-domain.com) instead of default ve.ai URLs.

## Technical Architecture

### Core Components
- **CloudFront Distribution**
  - Single distribution for all custom domains
  - Wildcard SSL certificate (*.ve.ai)
  - Lambda@Edge for request handling
  - No Route 53 dependency (customer manages DNS)

- **Domain Mapping System**
  - DynamoDB for domain → workspace mappings
  - Global tables for edge location access
  - Simple key-value schema for optimal performance
  - In-memory caching at Lambda@Edge

### Request Flow
1. **DNS Resolution**
   - Customer's DNS provider handles CNAME record
   - Points to domain.ve.ai (like Pixieset's domain.pixieset.com)
   - No complex DNS delegation required

2. **Request Processing**
   - CloudFront receives request
   - Lambda@Edge looks up workspace from domain
   - Adds workspace-id header
   - Amplify serves correct workspace content

3. **Domain Registration**
   - API endpoint for domain registration
   - Async DNS verification (like Pixieset)
   - Status tracking in DynamoDB
   - Simple CNAME-based verification

## Technical Decisions

### Why DynamoDB?
1. **Lambda@Edge Requirements**
   - Ultra-low latency (5-50ms max)
   - No VPC access from edge locations
   - Global availability needed
   - Simple key-value lookups

2. **Alternatives Considered**
   - RDS/Aurora: VPC required, high latency
   - Redis/ElastiCache: VPC required, regional only
   - Custom solution: Unnecessary complexity

### Why Lambda@Edge In-Memory Caching?
1. **Performance Impact**
   - Without cache: ~5-10ms per lookup (Lambda@Edge → DynamoDB)
   - With cache: microsecond latency (Lambda@Edge memory only)
   - 95% reduction in DynamoDB reads
   - No network calls needed for cached domains

2. **How it Works in Lambda@Edge**
   - Lambda function maintains in-memory Map
   - 5-minute TTL per domain entry
   - Automatic expiration of old entries
   - Lambda container reuse preserves cache
   - Each edge location has its own cache

Note: This is different from DynamoDB's own features. We're caching in the Lambda@Edge function itself to avoid even making the DynamoDB call.

## Cost-Performance Analysis

### Regular Production Load
- Estimated users: 1000 paid users
- Average domains per user: 2
- Total domains: ~2000 records
- Record size: ~1KB per domain
- Total data size: ~2MB
- Global Tables in 3 regions: ~6MB total

### Costs (Monthly)
- DynamoDB: $1-2
  - Write capacity: minimal (few domain updates/day)
  - Read capacity: minimal (with Lambda@Edge caching)
  - Global Tables replication: minimal data size
  - Storage: negligible for 6MB
- CloudFront: Standard pricing
- Lambda@Edge: Minimal (microsecond executions)

### Performance Metrics
- First request: 5-10ms
- Cached requests: microseconds
- Global replication: automatic
- DNS propagation: 5-30 minutes (standard)

## Key Benefits
1. **Technical**
   - No infrastructure changes needed
   - Automatic SSL handling
   - Global availability
   - High performance

2. **Operational**
   - Simple customer setup (single CNAME)
   - Minimal maintenance overhead
   - Automatic scaling
   - Easy troubleshooting

3. **Business**
   - Quick implementation
   - Low operational costs
   - Matches competitor features
   - Easy customer adoption

## Risks and Mitigations
1. **DNS Propagation**
   - Status tracking
   - Clear user communication
   - Automatic verification

2. **Performance**
   - In-memory caching
   - Global table replication
   - Edge location processing

3. **Cost Control**
   - Cache-first approach
   - TTL optimization
   - Auto-scaling limits
