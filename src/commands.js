/**
 * Share command metadata from a common spot to be used for both runtime
 * and registration.
 */


export const INVITE_COMMAND = {
  name: 'invite',
  description: 'Get an invite link to add the bot to your server',
};

export const TEST_COMMAND = {
  name: 'test',
  description: 'Test command',
};

export const GET_USER_DATA = {
  name: 'getuserdata',
  description: 'Fetches data for user'
}

export const SET_USER_DATA = {
  name: 'setuserdata',
  description: 'Sets data for user'
}

export const COINFLIP_COMMAND = {
  name: 'coinflip',
  description: 'Flips a coin',
  options: [
    {
      name: 'ephemeral',
      description: 'Make the response ephemeral',
      type: 5, // BOOLEAN
      required: false,
    },
  ],
};

export const EIGHTBALL_COMMAND = {
  name: '8ball',
  description: 'Ask the magic 8-ball a question',
  options: [
    {
      name: 'question',
      description: 'The question to ask the magic 8-ball',
      type: 3, // STRING
      required: true,
    },
    {
      name: 'ephemeral',
      description: 'Make the response ephemeral',
      type: 5, // BOOLEAN
      required: false,
    },
  ],
};