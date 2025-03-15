# VE.AI Custom Domain Implementation Plan

## Task Summary

### 1. Infrastructure
- CloudFront + Wildcard SSL (*.ve.ai)
- Static IPs for naked domains (104.16.x.x)
- CNAME target: domain.ve.ai

### 2. Backend
- Domain tracking database
- DNS verification system
- SSL certificate automation

### 3. Frontend
- Settings > Branding page
- Domain setup wizard
- Status monitoring

### 4. Support
- DNS setup guides
- Troubleshooting steps
- Error handling

## Phase 1: DNS Infrastructure

### CloudFront Setup
1. Configure CloudFront distribution
   - Origin: VE.AI Amplify app
   - Alternate domain names: *.ve.ai
   - SSL: ACM wildcard certificate

2. Static IP Configuration
   - Primary IP: 104.16.185.173 (or similar AWS IP)
   - Secondary IP: 104.16.186.173 (or similar AWS IP)
   - Configure both IPs in CloudFront

## Phase 2: Domain Management System

### Tenant DNS Setup Options

1. CNAME Record (Primary Method)
```
Type: CNAME
Host: gallery (or client's choice)
Points to: domain.ve.ai
TTL: 1 Hour
```

2. A Records (Optional, for naked domain)
```
Type: A
Host: @
Points to: [Primary IP, Secondary IP]
TTL: 1 Hour
```

### Database Schema
```sql
CREATE TABLE tenant_domains (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    domain VARCHAR(255) UNIQUE NOT NULL,
    status ENUM('pending','active','error'),
    created_at TIMESTAMP DEFAULT NOW()
);
```

## Phase 3: User Interface

### Settings Page
1. Client Gallery > Settings > Branding
   - Default domain: {username}.ve.ai
   - "+ Add custom domain" button
   - Domain status indicator
   - Clear setup instructions

### Domain Setup Flow
1. Click "Add custom domain"
2. Enter domain (e.g., gallery.yourdomain.com)
3. Show DNS configuration instructions
4. Verify and Save
5. Wait for DNS propagation

## Phase 4: Verification System

### Domain Verification
1. Check CNAME points to domain.ve.ai
2. Verify DNS propagation
3. Issue SSL certificate
4. Activate domain

### Error Handling
1. Common Issues:
   - DNS propagation (48h wait)
   - SSL generation (24h wait)
   - Incorrect DNS settings
   - Domain conflicts

2. Error Messages:
   - Clear instructions
   - Visual DNS guides
   - Troubleshooting steps
   - Support contact info