import { DynamoDB } from '@aws-sdk/client-dynamodb';

const dynamoDB = new DynamoDB({
  region: 'us-east-1'
});

// Simple in-memory cache
const cache = {};
const CACHE_TTL = 300000; // 5 minutes

// Helper for structured logging
function log(level, message, data = {}) {
  // Ensure error objects are properly serialized
  if (data.error instanceof Error) {
    data.error = {
      message: data.error.message,
      stack: data.error.stack,
      name: data.error.name
    };
  }
  
  // Clean up circular references and large objects
  const cleanData = JSON.parse(JSON.stringify(data, (key, value) => {
    if (key === 'headers' && typeof value === 'object') {
      // Only include essential headers
      return {
        host: value.host,
        'user-agent': value['user-agent']
      };
    }
    return value;
  }));

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...cleanData
  }));
}

export const handler = async (event) => {
  try {
    log('info', 'Received request', { eventType: event?.Records?.[0]?.cf?.config?.eventType });

    // Validate CloudFront event structure
    if (!event?.Records?.[0]?.cf?.request) {
      log('error', 'Invalid event structure', { event });
      throw new Error('Invalid event structure');
    }

    const request = event.Records[0].cf.request;
    if (!request.headers?.host?.[0]?.value) {
      log('error', 'Missing host header', { headers: request.headers });
      throw new Error('Missing host header');
    }

    const host = request.headers.host[0].value.toLowerCase(); // Normalize to lowercase
    log('info', 'Processing request', { host, uri: request.uri });
    
    // If this is already the Amplify domain, don't process it
    if (host.includes('amplifyapp.com')) {
      log('info', 'Skipping Amplify domain', { host });
      return request;
    }

    let workspaceId;

    // Check if this is a VE.AI domain
    if (host.endsWith('ve.ai')) {
      // Extract workspace ID from subdomain: workspace-1.ve.ai -> workspace-1
      workspaceId = host.split('.')[0];
      log('info', 'VE.AI domain, extracted workspace', { host, workspaceId });
    } else {
      // For custom domains, check cache first
      if (cache[host] && cache[host].expiry > Date.now()) {
        log('info', 'Cache hit', { host, cached: cache[host] });
        if (cache[host].workspaceId) {
          workspaceId = cache[host].workspaceId;
          log('info', 'Using cached workspace', { host, workspaceId });
        } else {
          log('info', 'Cache indicates domain not configured', { host });
          return createNotFoundResponse(host);
        }
      } else {
        // Query DynamoDB for custom domain mapping
        log('info', 'Looking up domain mapping', { host });
        const params = {
          TableName: 'domain-workspace-mappings',
          Key: {
            domain: { S: host }
          }
        };
        
        try {
          const { Item } = await dynamoDB.getItem(params);
          log('debug', 'DynamoDB GetItem response', { 
            hasItem: !!Item,
            workspaceId: Item?.workspaceId?.S,
            status: Item?.status?.S 
          });
          
          if (!Item?.workspaceId?.S || Item.status?.S !== 'active') {
            log('info', 'No active mapping found', { 
              host,
              hasWorkspaceId: !!Item?.workspaceId?.S,
              status: Item?.status?.S
            });
            // Update cache to remember this domain is not configured
            cache[host] = {
              workspaceId: null,
              expiry: Date.now() + CACHE_TTL
            };
            return createNotFoundResponse(host);
          }

          workspaceId = Item.workspaceId.S;
          log('info', 'Found mapping', { host, workspaceId });
          
          // Update cache only for valid mappings
          cache[host] = {
            workspaceId,
            expiry: Date.now() + CACHE_TTL
          };
        } catch (dbError) {
          log('error', 'DynamoDB error', { 
            error: dbError,
            operation: 'getItem',
            params: { 
              TableName: params.TableName,
              Key: { domain: host }
            }
          });
          return {
            status: '500',
            statusDescription: 'Internal Server Error',
            headers: {
              'content-type': [{
                key: 'Content-Type',
                value: 'text/plain'
              }],
            },
            body: 'An error occurred while looking up the domain configuration'
          };
        }
      }
    }

    // Set the origin domain and modify path to include workspace
    const newDomain = 'master.d1ul468muq9dvs.amplifyapp.com';
    const newUri = `/${workspaceId}${request.uri}`;
    log('info', 'Setting origin', { host, newDomain, newUri });
    request.origin = {
      custom: {
        domainName: newDomain,
        port: 443,
        protocol: 'https',
        path: '',
        sslProtocols: ['TLSv1.2'],
        readTimeout: 30,
        keepaliveTimeout: 5,
        customHeaders: {},
        originProtocolPolicy: 'https-only'
      }
    };
    request.headers.host = [{ key: 'Host', value: newDomain }];
    request.uri = newUri;
    
    log('debug', 'Returning modified request', { 
      host: request.headers.host[0].value,
      origin: request.origin.custom.domainName,
      uri: request.uri
    });
    return request;
  } catch (error) {
    log('error', 'Handler error', { 
      error,
      type: error.constructor.name,
      status: error.status
    });

    // If error is already a response (like our NotFound), return it
    if (error.status) {
      return error;
    }

    // For other errors, return a 500
    return {
      status: '500',
      statusDescription: 'Internal Server Error',
      headers: {
        'content-type': [{
          key: 'Content-Type',
          value: 'text/plain'
        }],
      },
      body: 'An error occurred processing your request'
    };
  }
};

function createNotFoundResponse(host) {
  return {
    status: '404',
    statusDescription: 'Not Found',
    headers: {
      'content-type': [{
        key: 'Content-Type',
        value: 'text/plain'
      }],
    },
    body: `Domain ${host} is not configured. Please check your domain settings in the VE.AI dashboard.`
  };
}
