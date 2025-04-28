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

export async function fetchFullUserDetails(userId) {
  const token = 'YOUR_BOT_TOKEN';  // Your bot's token
  const url = `https://discord.com/api/v10/users/${userId}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bot ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch user data');
  }

  const user = await response.json();
  return user;
}