export const handler = async (event) => {
  try {
    console.log('=== START ORIGIN REQUEST ===', JSON.stringify(event));

    // Validate CloudFront event structure
    if (!event?.Records?.[0]?.cf?.request) {
      console.error('Invalid event structure', { event });
      throw new Error('Invalid event structure');
    }

    const request = event.Records[0].cf.request;
    
    // Check if we have a custom host header
    if (request.headers['x-custom-host']?.[0]?.value) {
      const customHost = request.headers['x-custom-host'][0].value;
      console.log('Setting Host header', { customHost });
      
      // Log the request details
      console.log('Origin request details', {
        uri: request.uri,
        customHost,
        originalHost: request.headers.host?.[0]?.value
      });

      // Set the Host header to the custom host
      request.headers.host = [{
        key: 'Host',
        value: customHost
      }];
      
      // Remove the custom host header as it's no longer needed
      delete request.headers['x-custom-host'];
    }

    console.log('=== TRANSFORMED REQUEST ===', JSON.stringify(request));
    return request;
  } catch (error) {
    console.error('Handler error', { 
      error,
      type: error.constructor.name,
      status: error.status
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
      body: 'An error occurred processing your request'
    };
  }
};
