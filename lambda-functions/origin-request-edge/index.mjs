export const handler = async (event) => {
  try {
    console.log('=== START REQUEST ===', JSON.stringify(event));

    // Validate CloudFront event structure
    if (!event?.Records?.[0]?.cf?.request) {
      throw new Error('Invalid event structure');
    }

    const request = event.Records[0].cf.request;
    console.log('Processing request', { 
      uri: request.uri,
      headers: JSON.stringify(request.headers)
    });

    // If x-custom-host header is present, use it as the new Host header
    if (request.headers['x-custom-host']) {
      request.headers.host = [{
        key: 'Host',
        value: request.headers['x-custom-host'][0].value
      }];
      delete request.headers['x-custom-host'];
    }

    // Pass through debug headers
    if (request.headers['x-debug-workspace']) {
      request.headers['x-debug-workspace'] = request.headers['x-debug-workspace'];
    }
    if (request.headers['x-debug-original-uri']) {
      request.headers['x-debug-original-uri'] = request.headers['x-debug-original-uri'];
    }
    if (request.headers['x-debug-transformed-uri']) {
      request.headers['x-debug-transformed-uri'] = request.headers['x-debug-transformed-uri'];
    }

    // For index.html requests, add meta tags with debug info
    if (request.uri.endsWith('/') || request.uri.endsWith('index.html')) {
      const debugInfo = {
        'x-debug-workspace': request.headers['x-debug-workspace']?.[0]?.value,
        'x-debug-original-uri': request.headers['x-debug-original-uri']?.[0]?.value,
        'x-debug-transformed-uri': request.headers['x-debug-transformed-uri']?.[0]?.value
      };

      // Add a header to signal Amplify to inject meta tags
      request.headers['x-amz-meta-debug'] = [{
        key: 'X-Amz-Meta-Debug',
        value: JSON.stringify(debugInfo)
      }];
    }

    console.log('=== TRANSFORMED REQUEST ===', JSON.stringify(request));
    return request;
  } catch (error) {
    console.error('Handler error', { 
      error: error.message,
      stack: error.stack
    });
    return request;
  }
};
