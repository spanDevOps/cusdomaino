import { DynamoDB } from '@aws-sdk/client-dynamodb';

const dynamoDB = new DynamoDB({
  region: 'us-east-1',
});

const CACHE_TTL = 300000; // 5 minutes in milliseconds
const cache = {};

function log(level, message, data = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  }));
}

export const handler = async (event) => {
  try {
    log('info', 'Received request', { 
      eventType: event?.Records?.[0]?.cf?.config?.eventType,
      event: JSON.stringify(event)
    });

    // Validate CloudFront event structure
    if (!event?.Records?.[0]?.cf?.request) {
      throw new Error('Invalid CloudFront event structure');
    }

    const request = event.Records[0].cf.request;
    if (!request?.headers?.host?.[0]?.value) {
      throw new Error('Missing host header');
    }

    const host = request.headers.host[0].value.toLowerCase(); // Normalize to lowercase
    log('info', 'Processing request', { 
      host, 
      uri: request.uri,
      headers: request.headers,
      origin: request.origin
    });

    // If this is already the Amplify domain, don't process it
    if (host.includes('amplifyapp.com')) {
      log('info', 'Skipping Amplify domain', { host });
      return request;
    }

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
        status: Item?.status?.S,
        item: JSON.stringify(Item)
      });
      
      if (!Item || !Item.workspaceId?.S || Item.status?.S !== 'active') {
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

      const workspaceId = Item.workspaceId.S;
      log('info', 'Found mapping', { host, workspaceId });
      
      // Update cache only for valid mappings
      cache[host] = {
        workspaceId,
        expiry: Date.now() + CACHE_TTL
      };

      const transformedRequest = transformRequest(request, workspaceId);
      log('info', 'Transformed request', { 
        originalHost: host,
        originalUri: request.uri,
        newHost: transformedRequest.headers.host[0].value,
        newUri: transformedRequest.uri,
        newOrigin: transformedRequest.origin.custom.domainName
      });
      return transformedRequest;
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
  } catch (error) {
    log('error', 'Handler error', {
      error,
      event: JSON.stringify(event)
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
      body: 'An error occurred while processing the request'
    };
  }
};

// Helper to transform request to workspace path
function transformRequest(request, workspaceId) {
  const newDomain = 'master.d1ul468muq9dvs.amplifyapp.com';
  // Always ensure request.uri starts with /
  const requestUri = request.uri.startsWith('/') ? request.uri : `/${request.uri}`;
  // Add workspace to path: /workspace-1/path
  const newUri = `/${workspaceId}${requestUri}`;
  
  log('info', 'Setting origin', { 
    originalHost: request.headers.host[0].value,
    newDomain,
    originalUri: request.uri,
    newUri,
    request: JSON.stringify(request)
  });
  
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
    uri: request.uri,
    request: JSON.stringify(request)
  });
  return request;
}

// Helper to create 404 response
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
    body: `Domain ${host} is not configured`
  };
}
