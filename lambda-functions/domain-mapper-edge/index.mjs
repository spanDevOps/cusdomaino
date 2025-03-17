import { DynamoDB } from '@aws-sdk/client-dynamodb';

const dynamoDB = new DynamoDB({
  region: 'us-east-1'
});

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
    log('info', '=== START REQUEST ===', { 
      eventType: event?.Records?.[0]?.cf?.config?.eventType,
      event: JSON.stringify(event)
    });

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
    log('info', 'Processing request', { 
      host, 
      uri: request.uri,
      headers: JSON.stringify(request.headers),
      origin: JSON.stringify(request.origin)
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
        return createNotFoundResponse(host);
      }

      const workspaceId = Item.workspaceId.S;
      log('info', 'Found mapping', { host, workspaceId });

      // Create a deep copy of the request
      const transformedRequest = JSON.parse(JSON.stringify(request));

      // Always ensure request.uri starts with /
      const requestUri = request.uri.startsWith('/') ? request.uri : `/${request.uri}`;
      
      // Check if the path already contains a workspace ID
      const workspaceMatch = requestUri.match(/^\/workspace-\d+/);
      
      // If the path already has a workspace ID, leave it as is
      // Otherwise, add the workspace ID from DynamoDB
      const workspaceNumber = workspaceId.split('-')[1];
      transformedRequest.uri = workspaceMatch ? requestUri : `/workspace-${workspaceNumber}${requestUri === '/' ? '' : requestUri}`;

      // Log the path transformation
      log('info', 'Path transformation', {
        originalUri: request.uri,
        transformedUri: transformedRequest.uri,
        host: request.headers.host[0].value
      });

      // For viewer-request, we can't modify the Host header
      // Instead, we'll store the target host in x-custom-host
      // and let origin-request handle it
      transformedRequest.headers['x-custom-host'] = [{
        key: 'X-Custom-Host',
        value: 'master.d1ul468muq9dvs.amplifyapp.com'
      }];
      
      log('info', '=== TRANSFORMED REQUEST ===', { 
        originalHost: host,
        originalUri: request.uri,
        newUri: transformedRequest.uri,
        customHost: transformedRequest.headers['x-custom-host'][0].value,
        transformedRequest: JSON.stringify(transformedRequest)
      });

      // Add debug headers
      transformedRequest.headers['x-debug-workspace'] = [{
        key: 'X-Debug-Workspace',
        value: workspaceId
      }];
      transformedRequest.headers['x-debug-original-uri'] = [{
        key: 'X-Debug-Original-Uri',
        value: request.uri
      }];

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
