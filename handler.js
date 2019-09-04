'use strict';

import AWS from 'aws-sdk';
import querystring from 'querystring';

AWS.config.update({region: 'us-east-1'});

const db = new AWS.DynamoDB.DocumentClient();

const helpTextShort = `Request a Checkin with\n"! some optional message"\n\nAnonymous Message with\n"@ some message"\n\nChange your name with\n"$ your name"\n\nAndon Help with\n"?"`;
const helpTextLong  = `You can Send me "!" at any point and I'll let the hosts to check in with you; If you include a message, I'll pass it along too.\n\n` +
                      `You can also send me "@" with a message and I'll pass the message along anonymously.\n\n` +
                      `If you want to change your name, send me "$" with the name that you want.\n\n`;

const generateId = () => {
  var text = "";
  var possible = "ABCDEFGHJKLMNPQRSTUXYZ123456789";

  for (var i = 0; i < 3; i++)
    text += possible.charAt(Math.floor(Math.random() * possible.length));

  return text;
}

const fetchGuest = async body => {
  const params = {
    TableName: process.env.GUESTS_TABLE,
    Key: {
      smsNumber: body.From,
    }
  };

  try {
    const guest = await db.get(params).promise();
    return guest.Item;
  } catch (error) {
    console.error('FETCH GUEST ERROR', error);
    return 'Something went wrong, please wait a moment and try again.';
  }
}

const buildMessage = message => ({
  statusCode: 200,
  headers: { 'content-type': 'text/xml'},
  body: `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`
})

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
    
    return `Hi ${body.Body}. You're all set. \n\n${helpTextLong}`

  } catch (error) {
    console.error('ERROR SAVING PROFILE', error);
    return 'Something went wrong, please wait a moment and try again.';
  }
}

const helpMessage = guest => {
  return `Hi ${guest.name}, Hopefully this helps you. \n\n${helpTextLong}`
}

const returningGuest = guest => {
  return `Hi ${guest.name}! How can I help you?\n\n${helpTextShort}`;
}

const anonMessage = async body => {
  try {
    const params = {
      TableName: process.env.MESSAGES_TABLE,
      Item: {
        messageId: generateId(),
        type: 'ANONYMOUS',
        text: body.Body,
        createdAt: new Date().toISOString()
      }
    };    
    
    await db.put(params).promise();

    return 'Got it, passing that it along now anonymously';
  } catch (error) {
    console.log('ANON MESSAGE ERROR', error)
    return 'Oh no, something went wrong, please wait a moment and try again';
  }
}

const checkInRequest = async (guest, body) => {
  try {
    const params = {
      TableName: process.env.MESSAGES_TABLE,
      Item: {
        messageId: generateId(),
        type: 'CHECKIN',
        guestSmsNumber: guest.smsNumber,
        text: body.Body,
        createdAt: new Date().toISOString()
      }
    };    
    
    await db.put(params).promise();

    return 'Got it, sending the request.';
  } catch (error) {
    console.log('ANON MESSAGE ERROR', error)
    return 'Oh no, something went wrong, please wait a moment and try again';
  }
}

const processMessage = async body => {
  const guest = await fetchGuest(body);
  if(!guest) {
    return registerGuest(body);
  }

  const command = body.Body.trim()[0];
  switch(command) {
    case '?':
      return helpMessage(guest);
    case '@':
      return anonMessage(body);
    case '!':
      return checkInRequest(guest, body);
    default:
      return returningGuest(guest);
  };
};

export const receiveSms = async event => {
  const body = querystring.parse(event.body);
  console.log(JSON.stringify(body));
  
  try {
    const message = await processMessage(body);
    return buildMessage(message);
  } catch (error) {
    console.error(error);
    return buildMessage('Oh no, something went wrong, please wait a moment and try again');
  }
}