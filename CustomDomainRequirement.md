# Custom Domain Solution for VE.AI

## Current System Architecture

### User Types
1. **Tenants**
   - Primary customers of VE.AI
   - Upload photos to the platform
   - Have their own domain/website

2. **Clients**
   - End users (customers of Tenants)
   - Access their personalized galleries
   - Need to access through tenant's domain (e.g., `gallery.tenant-domain.com`)
   - Only see AI-processed images where they are the focus/subject

### Existing Infrastructure
- **AWS Route 53**: DNS management (routes traffic to cloudfront)
- **AWS CloudFront**: Content delivery network (path based behaviour amplify targets along with x-workspace-id in headers)
- **AWS Amplify**: Web application hosting (x-workspace-id is compulsory to serve content)
- Current system needs integration with tenant domains

## Problem Statement

### Client Requirements
- Clients need to access galleries through tenant's domain
- Example: `gallery.tenant-domain.com` or `photos.tenant-domain.com`
- Professional integration with tenant's brand

### Tenant Requirements
- Ability to use their own domain for client galleries
- Need to provide custom subdomain access to their clients
- Maintain professional brand image
- Need solution that scales with their client base

## Technical Considerations

### Current Limitations
- URL structure tied to workspaceID
- No custom domain support
- Professional branding limitations

### Potential Solutions Scope
- Implementation of custom domain management
- Integration with existing AWS services
- Consideration of AWS Global Accelerator
- Need for cost-effective scaling solution

## Solution Requirements

### Technical Requirements
1. Custom subdomain support
2. Integration with existing AWS infrastructure
3. Scalable architecture
4. Minimal latency using AWS Global Accelerator
5. Automated domain provisioning

### Business Requirements
1. Cost-effective implementation
2. Easy management for tenants
3. Professional appearance for end clients
4. Minimal disruption to existing services