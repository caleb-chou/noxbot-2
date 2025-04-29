export class JsonResponse extends Response {
  constructor(body, init) {
    const jsonBody = JSON.stringify(body);
    init = init || {
      headers: {
        'content-type': 'application/json;charset=UTF-8',
      },
    };
    super(jsonBody, init);
  }
}

export async function sendMailNotification(recipientId, env) {
  const botToken = env.DISCORD_TOKEN; // you should store your bot token safely in environment variables
  
  // Step 1: Create a DM channel
  const dmChannelRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient_id: recipientId,
    }),
  });

  if (!dmChannelRes.ok) {
    console.error('Failed to create DM channel:', await dmChannelRes.text());
    return;
  }

  const dmChannel = await dmChannelRes.json();

  // Step 2: Send a message in that DM channel
  const messageRes = await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: `📬 You have new mail waiting for you! Check it with the \`/checkmail\` command!`,
    }),
  });

  if (!messageRes.ok) {
    console.error('Failed to send DM message:', await messageRes.text());
    return;
  }

  console.log('Notification sent successfully.');
}
