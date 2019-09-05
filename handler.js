'use strict';

import AWS from 'aws-sdk';
import querystring from 'querystring';
import { Twilio } from 'twilio';
import moment from 'moment';

AWS.config.update({region: 'us-east-1'});

const db = new AWS.DynamoDB.DocumentClient();
const twilio = new Twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);

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
        createdAt: new Date().toISOString(),
        status: 'OPEN',
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
        guestName: guest.name,
        text: body.Body,
        createdAt: new Date().toISOString(),
        status: 'OPEN',
      }
    };    
    
    await db.put(params).promise();

    return 'Got it, sending the request.';
  } catch (error) {
    console.log('ANON MESSAGE ERROR', error);
    return 'Oh no, something went wrong, please wait a moment and try again';
  }
}

const changeName = async (guest, body) => {
  const name = body.Body.split('$')[1].trim();

  const params = {
    TableName: process.env.GUESTS_TABLE,
    Key: { 
      'smsNumber' : guest.smsNumber,
    },
    ConditionExpression: '#smsNumber = :smsNumber',
    UpdateExpression: 'set #name = :name',
    ExpressionAttributeNames: {
      '#smsNumber' : 'smsNumber',
      '#name' : 'name',
    },
    ExpressionAttributeValues: {
      ':smsNumber' : guest.smsNumber,
      ':name' : name,
    }
  };

  try {
    await db.update(params).promise();

    return `Updated your name. Hi ${name}!`
  } catch (error) {
    console.error('CHANGE NAME ERROR', error);
    return 'Something went wrong, please wait a moment and try again.';
  }  
}

const processAckCode = async (guest, body) => {
  if(guest.role !== 'TYRANT') {
    return null;
  }

  const messageId = body.Body.trim().substring(0, 3).toUpperCase();

  const params = {
    TableName: process.env.MESSAGES_TABLE,
    Key: { 
      messageId,
    },
    ConditionExpression: '#messageId = :messageId',
    UpdateExpression: 'set #status = :status',
    ExpressionAttributeNames: {
      '#messageId' : 'messageId',
      '#status' : 'status' 
    },
    ExpressionAttributeValues: {
      ':messageId' : messageId,
      ':status' : 'ACKNOWLEDGED'
    }
  };

  try {
    await db.update(params).promise();

    return `Acknowledged ${messageId}`
  } catch (error) {
    if(error.code === 'ConditionalCheckFailedException') {
      return null;
    }

    console.error('ACK CODE ERROR', error);
    return 'Something went wrong, please wait a moment and try again.';
  }  
}

const processMessage = async body => {
  const guest = await fetchGuest(body);
  if(!guest) {
    return registerGuest(body);
  }

  const command = body.Body.trim()[0];
  switch(command) {
    case '$':
      return changeName(guest, body);
    case '?':
      return helpMessage(guest);
    case '@':
      return anonMessage(body);
    case '!':
      return checkInRequest(guest, body);
    default:
      let ackCodeResponse  = await processAckCode(guest, body);
      if(ackCodeResponse) {
        return ackCodeResponse;
      }

      return returningGuest(guest);
  };
};

const sendText = async (to, body) => {
  const textContent = {
    to,
    body,
    from: process.env.TWILIO_SMS_NUMBER,
  };

  await twilio.messages.create(textContent);
}

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

export const messageCreated = async event => {
  console.log(JSON.stringify(event));

  const params = {
    TableName: process.env.GUESTS_TABLE,
    KeyConditionExpression: '#role = :role',
    ExpressionAttributeNames: {
      '#role': 'role'
    },
    ExpressionAttributeValues: {
      ':role': 'TYRANT'
    },
    IndexName: 'role-smsNumber-index'
  };

  let tyrants = [];

  try {
    const query = await db.query(params).promise();
    tyrants = query.Items.map(item => item);
  } catch (error) {
    console.log('FETCH TYRANTS', error);
  }

  for(let record of event.Records) {
    if(record.eventName === 'INSERT') {
      const message = {
        messageId: (record.dynamodb.NewImage.messageId || {}).S,
        createdAt: (record.dynamodb.NewImage.createdAt || {}).S,
        text: (record.dynamodb.NewImage.text || {}).S,
        type: (record.dynamodb.NewImage.type || {}).S,
        guestSmsNumber: (record.dynamodb.NewImage.guestSmsNumber || {}).S
      };

      let body = `${message.text}\n\nReply with code "${message.messageId}" to acknowledge`;
      if(message.type === 'ANONYMOUS') {
        body = `Anonymous Message:\n${body}`;
      } else {
        body = `From ${message.guestName}:\n${body}`;
      }

      for(let tyrant of tyrants) {
        await sendText(tyrant.smsNumber, body);
      }
    }
  }
  
  return true;
}

export const escalateNotifications = async escalateNotifications => {
  const threashold = moment().subtract(2, 'minutes').toISOString();

  try {
    let messagesParams = {
      TableName : process.env.MESSAGES_TABLE,
      IndexName: 'status-created_at-index',
      KeyConditionExpression: '#status = :status AND createdAt < :threashold',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'OPEN',
        ':threashold': threashold,
      }
    };

    const messages = await db.query(messagesParams).promise();
    console.log('messages', messages);

    if(messages.Items.length === 0) return;

    const captainsParams = {
      TableName: process.env.GUESTS_TABLE,
      KeyConditionExpression: '#role = :role',
      ExpressionAttributeNames: {
        '#role': 'role'
      },
      ExpressionAttributeValues: {
        ':role': 'CAPTAIN'
      },
      IndexName: 'role-index'
    };
  
    const captains = await db.query(captainsParams).promise();

    console.log('captains', captains);

    const messageIds = messages.Items.map(m => m.messageId).join('\n');
    const body = `Please connect with party hosts about unacknowledged messages:\n\n${messageIds}`;

    console.log('messageIds', messageIds);

    for(let captain of captains.Items) {
      await sendText(captain.smsNumber, body);
    }
  } catch (error) {
    console.log('ERROR MESSAGING ASSISTANTS', error);
  }
}