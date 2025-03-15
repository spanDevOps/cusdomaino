# Testing Custom Domain Implementation

## Prerequisites
1. AWS Test Account with Console Access
2. Domain: devopsify.shop (GoDaddy account access)
3. GitHub account

## Step 1: Deploy Test Application

### 1.1 Setup Test App
1. Create a new GitHub repository:
   - Name: ve-ai-test-app
   - Make it public
   - Don't initialize with README

2. Push test app to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin git@github.com:spanDevOps/ve-ai-test-app.git
   git push -u origin main
   ```

3. Test locally:
   ```bash
   npm install
   npm start
   ```
   
   Note: Local development will use a default workspace-1 since we can't simulate subdomains locally.

### 1.2 Deploy to AWS Amplify
1. Open AWS Amplify Console
2. Click "New App" → "Host Web App"
3. Choose GitHub as source
4. Select ve-ai-test-app repository
5. Configure build settings:
   ```yaml
   version: 1
   frontend:
     phases:
       preBuild:
         commands:
           - npm ci
       build:
         commands:
           - npm run build
     artifacts:
       baseDirectory: build
       files:
         - '**/*'
     cache:
       paths:
         - node_modules/**/*
   ```

6. Deploy and verify:
   - App builds successfully
   - Test with subdomain: workspace-1.abc123.amplifyapp.com

## Step 2: Infrastructure Setup

### 2.1 Create DynamoDB Table
1. Open DynamoDB Console
2. Click "Create Table"
   - Table name: domain-workspace-mappings
   - Partition key: domain (String)
   - Settings: Use default settings

3. Add test mappings:
   ```json
   {
     "domain": "gallery.devopsify.shop",
     "workspaceId": "workspace-1",
     "status": "active",
     "createdAt": "2025-03-14T12:36:17Z"
   }
   {
     "domain": "photos.devopsify.shop",
     "workspaceId": "workspace-2",
     "status": "active",
     "createdAt": "2025-03-14T12:36:17Z"
   }
   {
     "domain": "studio.devopsify.shop",
     "workspaceId": "workspace-3",
     "status": "active",
     "createdAt": "2025-03-14T12:36:17Z"
   }
   ```

### 2.2 Create CloudFront Distribution
1. Open Certificate Manager (us-east-1 region)
2. Request wildcard certificate
   - Domain: *.devopsify.shop
   - Validation: DNS validation
   - Follow validation steps in GoDaddy

3. Open CloudFront Console
4. Create Distribution
   - Origin domain: Your Amplify app domain
   - Viewer protocol policy: Redirect HTTP to HTTPS
   - Alternate domain names (CNAMEs): *.devopsify.shop
   - Custom SSL certificate: Select your ACM certificate
   - Default root object: index.html
   - Lambda Function Associations:
     - Viewer Request: domain-mapper-edge

### 2.3 Create Lambda@Edge Function
1. Open Lambda Console (us-east-1 region)
2. Create function
   - Name: domain-mapper-edge
   - Runtime: Node.js 18.x
   - Permissions: Create new role with basic Lambda@Edge permissions

3. Add code:
   ```javascript
   const AWS = require('aws-sdk');
   const dynamoDB = new AWS.DynamoDB.DocumentClient({
     region: 'us-east-1'
   });
   
   // Simple in-memory cache
   const cache = {};
   const CACHE_TTL = 300000; // 5 minutes
   
   exports.handler = async (event) => {
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
       }).promise();
       
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

4. Deploy to Lambda@Edge
   - Publish new version
   - Copy ARN for CloudFront

## Step 3: DNS Configuration

### 3.1 Configure GoDaddy DNS
1. Login to GoDaddy
2. Go to DNS Management for devopsify.shop
3. Add CNAME records:
   ```
   gallery.devopsify.shop  CNAME  [CloudFront Distribution Domain]  TTL: 1 Hour
   photos.devopsify.shop   CNAME  [CloudFront Distribution Domain]  TTL: 1 Hour
   studio.devopsify.shop   CNAME  [CloudFront Distribution Domain]  TTL: 1 Hour
   ```

## Step 4: Testing

### 4.1 Test Amplify Domain
1. Visit workspace-1.abc123.amplifyapp.com:
   - Should show Workspace ID: workspace-1
   - Domain Type: Development
   - Should display Development badge

2. Visit workspace-2.abc123.amplifyapp.com:
   - Should show Workspace ID: workspace-2
   - Domain Type: Development
   - Should display Development badge

### 4.2 Test Custom Domains
1. Visit gallery.devopsify.shop:
   - Should show Workspace ID: workspace-1
   - Domain Type: Custom Domain
   - Should display Custom Domain badge

2. Visit photos.devopsify.shop:
   - Should show Workspace ID: workspace-2
   - Domain Type: Custom Domain
   - Should display Custom Domain badge

3. Visit studio.devopsify.shop:
   - Should show Workspace ID: workspace-3
   - Domain Type: Custom Domain
   - Should display Custom Domain badge

### 4.3 Test Edge Cases
1. Visit unknown.devopsify.shop:
   - Should show Workspace ID: unknown
   - Should still work but indicate no mapping found

2. Test cache behavior:
   - Visit a custom domain multiple times
   - Check CloudWatch logs to verify cache hits
   - Wait 5+ minutes and verify cache refresh

### 4.4 Monitor Performance
1. CloudWatch Logs
   - Check Lambda@Edge logs
   - Look for any errors or slow responses

2. CloudWatch Metrics
   - Monitor Lambda execution times
   - Check DynamoDB read capacity usage
   - Monitor CloudFront cache hit rates
