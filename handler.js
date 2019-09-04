'use strict';

import querystring from 'querystring';

export const receiveSms = async event => {
  const body = querystring.parse(event.body);
  console.log(JSON.stringify(body));
  
  return {
    statusCode: 200,
    body: JSON.stringify(
      {
        message: 'Go Serverless v1.0! Your function executed successfully!',
        input: event,
      },
      null,
      2
    ),
  };
};
