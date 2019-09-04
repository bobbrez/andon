'use strict';

import AWS from 'aws-sdk';
import querystring from 'querystring';

AWS.config.update({region: 'us-east-1'});

const db = new AWS.DynamoDB.DocumentClient();

const registerGuest = async body => {
  const params = {
    TableName: process.env.GUESTS_TABLE,
    Item: {
      smsNumber: body.From,
      name: body.Body,
      createdAt: new Date().toISOString()
    }
  };

  try {
    await db.put(params).promise();
    
    return `Hi ${body.Body}. You're all set. \n\nSend me "!" at any point and I'll let the host know to check in with you; If you include a message, I'll pass it along too.\n\nOr send me "@" with a message to send a message to the host anonymously."`

  } catch (error) {
    console.error('ERROR SAVING PROFILE', error);
    return 'Something went wrong, please wait a moment and try again.';
  }
}

const buildMessage = message => ({
  statusCode: 200,
  headers: { 'content-type': 'text/xml'},
  body: `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`
})

const processMessage = (event, body) => {
  return registerGuest(body);
};

export const receiveSms = async event => {
  const body = querystring.parse(event.body);
  console.log(JSON.stringify(body));
  
  try {
    const message = await processMessage(event, body);
    return buildMessage(message);
  } catch (error) {
    console.error(error);
    return buildMessage('Oh no, something went wrong, please wait a moment and try again');
  }
}