# AWS Implementation Steps for Custom Domains

## Infrastructure Setup (Essential Components)

### 1. Update Existing CloudFront Distribution
1. Open CloudFront console > Select current distribution
2. Minimal required changes:
   ```
   Alternate domain names (CNAMEs):
     - Add: *.ve.ai
   
   SSL Certificate:
     - Request new ACM certificate for *.ve.ai
   ```
3. Add function association:
   ```
   Viewer request: domain-mapper-edge (Lambda@Edge)
   ```

Note: Keep existing workspace-id header and behavior settings as they are,
since they're already working with spandantest.ve.ai style URLs.

### 2. Create DynamoDB Table
1. Open DynamoDB console
2. Create table:
   ```
   Table name: domain-workspace-mappings
   Partition key: domain (String)
   
   Settings:
   - Enable auto-scaling
   - Enable point-in-time recovery
   - Enable server-side encryption
   
   Global Tables:
   - Enable replication in CloudFront regions
   ```
3. Example item:
   ```json
   {
     "domain": "gallery.client.com",
     "workspaceId": "spandantest",
     "status": "active",
     "createdAt": "2025-03-13T12:00:00Z",
     "verifiedAt": "2025-03-13T12:05:00Z"
   }
   ```

### 3. Create Lambda@Edge Function
1. Create function in us-east-1 (required for Lambda@Edge):
   ```javascript
   import { DynamoDB } from '@aws-sdk/client-dynamodb';
   import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';

   const client = new DynamoDB({
     region: 'us-east-1'
   });
   const dynamoDB = DynamoDBDocument.from(client);

   // Simple in-memory cache
   const cache = {};
   const CACHE_TTL = 300000; // 5 minutes

   export const handler = async (event) => {
     const request = event.Records[0].cf.request;
     const host = request.headers.host[0].value;
     
     console.log(`Processing request for domain: ${host}`);
     
     try {
       // Check cache
       if (cache[host] && cache[host].expiry > Date.now()) {
         console.log(`Cache hit for domain: ${host}`);
         if (cache[host].workspaceId) {
           request.origin.custom.domainName = `${cache[host].workspaceId}.${request.origin.custom.domainName}`;
         }
         return request;
       }
       
       // Query DynamoDB for domain mapping
       const { Item } = await dynamoDB.get({
         TableName: 'domain-workspace-mappings',
         Key: { domain: host }
       });
       
       // Update cache
       cache[host] = {
         workspaceId: Item ? Item.workspaceId : null,
         expiry: Date.now() + CACHE_TTL
       };
       
       if (Item) {
         console.log(`Found mapping: ${host} -> ${Item.workspaceId}`);
         // Modify the origin to point to the workspace-specific subdomain
         request.origin.custom.domainName = `${Item.workspaceId}.${request.origin.custom.domainName}`;
       }
     } catch (error) {
       console.error('Error:', error);
     }
     
     return request;
   };
   ```

2. Configure function settings:
   ```
   Runtime: Node.js 18.x
   Memory: 512 MB (Recommended for Edge functions)
   Timeout: 5 seconds
   IAM Role: domain-mapper-edge-role
   
   Note: 512 MB is recommended because:
   - Lambda@Edge runs at CloudFront locations worldwide
   - Higher memory = faster CPU allocation = lower latency
   - In-memory caching needs adequate space
   - Cost difference is minimal due to faster execution
   ```

3. Create IAM role with permissions:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "dynamodb:GetItem",
           "logs:CreateLogGroup",
           "logs:CreateLogStream",
           "logs:PutLogEvents"
         ],
         "Resource": [
           "arn:aws:dynamodb:us-east-1:*:table/domain-workspace-mappings",
           "arn:aws:logs:*:*:*"
         ]
       }
     ]
   }
   ```

### 4. Create Domain Management API
1. Create API Gateway endpoint:
   ```
   POST /api/domains/register
   Request body:
   {
     "subdomain": "gallery",          // User's desired subdomain
     "domain": "client-domain.com",   // User's domain
     "workspaceId": "spandantest"     // Current user's workspace
   }
   ```

2. Create registration Lambda:
   ```javascript
   import { ACM, CloudFront, DynamoDB } from '@aws-sdk/client-sdk';

   export const handler = async (event) => {
     const { subdomain, domain, workspaceId } = JSON.parse(event.body);
     const fullDomain = `${subdomain}.${domain}`;
     
     try {
       // 1. Validate paid user status
       const userStatus = await validatePaidUser(workspaceId);
       if (!userStatus.isPaid) {
         return {
           statusCode: 403,
           body: JSON.stringify({
             status: 'error',
             message: 'Custom domains require a paid subscription'
           })
         };
       }

       // 2. Validate domain format
       if (!isValidDomain(fullDomain)) {
         return {
           statusCode: 400,
           body: JSON.stringify({
             status: 'error',
             message: 'Invalid domain format'
           })
         };
       }

       // 3. Check if domain is already registered
       const existing = await dynamoDB.get({
         TableName: 'domain-workspace-mappings',
         Key: { domain: fullDomain }
       });

       if (existing.Item) {
         return {
           statusCode: 409,
           body: JSON.stringify({
             status: 'error',
             message: 'Domain already registered'
           })
         };
       }

       // 4. Request ACM Certificate with email validation
       const certRequest = await acm.requestCertificate({
         DomainName: fullDomain,
         ValidationMethod: 'EMAIL',
         DomainValidationOptions: [{
           DomainName: fullDomain,
           ValidationDomain: domain // Parent domain for validation emails
         }]
       });

       // 5. Create pending domain record
       await dynamoDB.put({
         TableName: 'domain-workspace-mappings',
         Item: {
           domain: fullDomain,
           workspaceId,
           status: 'pending_validation',
           certificateArn: certRequest.CertificateArn,
           createdAt: new Date().toISOString()
         }
       });

       return {
         statusCode: 200,
         body: JSON.stringify({
           status: 'pending_validation',
           message: 'Please check your email for domain validation'
         })
       };
     } catch (error) {
       console.error('Error:', error);
       return {
         statusCode: 500,
         body: JSON.stringify({
           status: 'error',
           message: 'Internal server error'
         })
       };
     }
   };
   ```

3. Create certificate validation Lambda:
   ```javascript
   import { ACM, CloudFront, DynamoDB } from '@aws-sdk/client-sdk';

   export const handler = async (event) => {
     // Run every 5 minutes via EventBridge
     const pendingDomains = await dynamoDB.query({
       TableName: 'domain-workspace-mappings',
       IndexName: 'status-index',
       KeyConditionExpression: 'status = :status',
       ExpressionAttributeValues: {
         ':status': 'pending_validation'
       }
     });

     for (const domain of pendingDomains.Items) {
       try {
         // Check certificate status
         const cert = await acm.describeCertificate({
           CertificateArn: domain.certificateArn
         });

         if (cert.Status === 'ISSUED') {
           // Certificate is validated (either by email or DNS)
           const distribution = await cloudfront.getDistribution({
             Id: process.env.CLOUDFRONT_DISTRIBUTION_ID
           });

           // Add domain to CloudFront
           const config = distribution.DistributionConfig;
           config.Aliases.Items.push(domain.domain);
           
           // Update certificate if needed
           if (!config.ViewerCertificate.ACMCertificateArn) {
             config.ViewerCertificate = {
               ACMCertificateArn: domain.certificateArn,
               SSLSupportMethod: 'sni-only',
               MinimumProtocolVersion: 'TLSv1.2_2021'
             };
           }

           await cloudfront.updateDistribution({
             Id: process.env.CLOUDFRONT_DISTRIBUTION_ID,
             DistributionConfig: config,
             IfMatch: distribution.ETag
           });

           // Update domain status
           await dynamoDB.update({
             TableName: 'domain-workspace-mappings',
             Key: { domain: domain.domain },
             UpdateExpression: 'SET status = :status, verifiedAt = :now',
             ExpressionAttributeValues: {
               ':status': 'active',
               ':now': new Date().toISOString()
             }
           });
         }
       } catch (error) {
         console.error(`Error processing domain ${domain.domain}:`, error);
       }
     }
   };
   ```

### 5. Domain Verification Lambda
```javascript
exports.handler = async (event) => {
  const { domain, workspaceId } = event;
  const dynamoDB = new AWS.DynamoDB.DocumentClient();
  
  try {
    // 1. Verify CNAME points to domain.ve.ai
    const dnsResult = await dns.resolveCname(domain);
    const isValid = dnsResult.includes('domain.ve.ai');
    
    if (isValid) {
      // 2. Store in DynamoDB
      await dynamoDB.put({
        TableName: 'domain-workspace-mappings',
        Item: {
          domain,
          workspaceId,
          status: 'active',
          createdAt: new Date().toISOString(),
          verifiedAt: new Date().toISOString()
        }
      }).promise();
      
      return { 
        status: 'verified',
        message: 'Domain verified and mapped successfully'
      };
    }
    
    return { 
      status: 'invalid_cname',
      message: 'Please ensure CNAME points to domain.ve.ai'
    };
  } catch (error) {
    console.error('Verification error:', error);
    return { 
      status: 'error',
      message: 'Could not verify domain. Check DNS configuration.'
    };
  }
};
```

## Request Flows

### 1. Domain Registration Flow (Like Pixieset's Client Gallery > Settings > Branding)
```
User Dashboard (ve.ai)    →    API Gateway    →    Registration Lambda
Settings > Branding             ↓                        ↓
Add Custom Domain        POST /api/domains/register    Creates pending
                                                     DynamoDB record
```

### 2. Domain Verification Flow (Similar to Pixieset's verification)
```
Frontend                 →    API Gateway    →    Verification Lambda
(Check status)                ↓                        ↓
Every 30s          GET /api/domains/verify/{domain}  Queries DNS
Show instructions                                    Updates status
```

### 3. Custom Domain Request Flow (Identical to Pixieset)
```
# Our System:
Browser Request          →    Customer DNS    →    CloudFront Edge    →    Amplify App
gallery.client.com            Provider            ↓                        ↓
                             CNAME →         Lambda@Edge:                 Serves
                             domain.ve.ai    1. Looks up workspace        workspace
                                           2. Adds workspace-id          content

# Pixieset's System:
Browser Request          →    Customer DNS    →    CloudFront Edge    →    Pixieset App
gallery.client.com            Provider            ↓                        ↓
                             CNAME →         Maps domain to              Serves
                             domain.pixieset.com  account                content
```

Note: 
- Like Pixieset, we use customer's existing DNS
- Simple CNAME setup (no complex DNS changes)
- Quick verification process
- Automatic SSL certificate handling

## Complete Flow

1. **User Registration**:
   ```
   Frontend                     Backend                      DNS
   --------                    -------                      ---
   Submit form     →     Check paid status
   (gallery.domain.com)   Create pending record
                         Return CNAME instructions
                         
   Show instructions    ←     Response
   to user
   ```

2. **DNS Update**:
   ```
   User's DNS Provider         Our System
   -----------------          ----------
   Add CNAME record    →    Wait for verification
   gallery → domain.ve.ai
   ```

3. **Verification**:
   ```
   Frontend                    Backend                     CloudFront
   --------                   -------                     ----------
   Check status    →    Verify CNAME exists
   periodically         Update DynamoDB status    →    Edge function
                                                      starts using
                                                      new mapping
   Show success    ←    Return verified status
   ```

## Why DynamoDB for Custom Domains

### Lambda@Edge Requirements
```
1. Ultra-low latency (5-50ms max execution time)
2. No VPC access from edge locations
3. Global availability (all CloudFront edge locations)
4. Simple key-value lookups (domain → workspaceId)
```

### Database Options Analysis

1. **DynamoDB**
   ```
   Pros:
   ✓ Global Tables - replicated to all regions
   ✓ Single-digit millisecond latency
   ✓ No VPC required
   ✓ Serverless (no connection management)
   ✓ Perfect for key-value lookups
   
   Cons:
   - Higher cost for frequent updates
   - Limited query patterns
   ```

2. **RDS/Aurora**
   ```
   Pros:
   ✓ Full SQL capability
   ✓ Complex queries possible
   ✓ Familiar technology
   
   Cons:
   ✗ VPC required (not accessible from Lambda@Edge)
   ✗ Regional only
   ✗ Connection pooling needed
   ✗ Higher latency (100-500ms from edge)
   ```

3. **Redis/ElastiCache**
   ```
   Pros:
   ✓ In-memory performance
   ✓ Flexible data structures
   
   Cons:
   ✗ VPC required
   ✗ Regional only
   ✗ Connection management overhead
   ✗ Not accessible from Lambda@Edge
   ```

### Cost-Performance Analysis
```
1. Regular Production Load:
   - 1M requests/day
   - 5KB per item
   - Global Tables in 3 regions
   
   Monthly costs (approximate):
   - DynamoDB: $30-50 (with auto-scaling)
   
2. Performance:
   - Average latency: 5-10ms
   - Global replication: automatic
```

### Why DynamoDB is the Best Choice
1. **Lambda@Edge Compatibility**
   - Direct access from edge locations
   - No VPC or connection management
   - Predictable low latency

2. **Operational Simplicity**
   - No connection pools
   - No failover handling
   - Automatic scaling

3. **Perfect Fit for Use Case**
   - Simple key-value lookups
   - Global availability
   - Matches our access patterns

4. **Future Growth**
   - Scales automatically
   - No replication management
   - No capacity planning needed

### Why Lambda@Edge Caching?
1. **Performance Benefits**
   ```
   Without Cache:
   Request → Lambda@Edge → DynamoDB → Response
   Latency: ~5-10ms

   With Cache:
   First Request:      Request → Lambda@Edge → DynamoDB → Cache → Response
   Subsequent Requests: Request → Lambda@Edge → Cache → Response
   Latency: microseconds for cache hits
   ```

2. **Cost Reduction**
   ```
   Example (1M requests/day):
   Without Cache: 1M DynamoDB reads/day
   With Cache (95% hit rate): 50K DynamoDB reads/day
   Savings: ~95% reduction in DynamoDB costs
   ```

3. **Implementation**
   ```javascript
   const cache = new Map();
   const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

   exports.handler = async (event) => {
     const request = event.Records[0].cf.request;
     const domain = request.headers.host[0].value;
     
     try {
       // Check cache first
       const cached = cache.get(domain);
       if (cached && cached.expiry > Date.now()) {
         request.headers['workspace-id'] = [{
           value: cached.workspaceId
         }];
         return request;
       }
       
       // Cache miss - query DynamoDB
       const { Item } = await dynamoDB.get({
         TableName: 'domain-workspace-mappings',
         Key: { domain }
       }).promise();
       
       if (!Item) {
         return request; // Domain not found
       }
       
       // Cache the result
       cache.set(domain, {
         workspaceId: Item.workspaceId,
         expiry: Date.now() + CACHE_TTL
       });
       
       request.headers['workspace-id'] = [{
         value: Item.workspaceId
       }];
       return request;
     } catch (error) {
       console.error('Error:', error);
       return request; // Continue without workspace-id on error
     }
   };
   ```

4. **Cache Management**
   - TTL: 5 minutes (configurable)
   - Auto-expires stale entries
   - Memory usage: ~1KB per domain
   - Lambda containers reuse cache between invocations

5. **Monitoring**
   ```javascript
   // Add CloudWatch metrics
   await cloudwatch.putMetricData({
     MetricData: [{
       MetricName: 'CacheHit',
       Value: cached ? 1 : 0,
       Unit: 'Count'
     }],
     Namespace: 'CustomDomain/Cache'
   }).promise();
   ```
