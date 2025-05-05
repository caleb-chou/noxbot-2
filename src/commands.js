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

export const INCREMENT_STATS_COMMAND = {
  name: 'incrementuserdata',
  description: 'Fetches data for user',
  options: [
    {
      name: 'user',
      description: 'The user to get data for',
      type: 6, // USER
      required: true,
    },
    {
      name: 'ephemeral',
      description: 'Make the response ephemeral',
      type: 5, // BOOLEAN
      required: false,
    },
    {
      name: 'stat',
      description: 'The stat to increment',
      type: 3, // STRING
      required: false,
    }
  ]
};

export const SET_USER_DATA = {
  name: 'setuserdata',
  description: 'Sets data for user',
};

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

export const GET_STATS_COMMAND = {
  name: 'getstats',
  description: 'Get stats for a user',
  options: [
    {
      name: 'user',
      description: 'The user to get stats for',
      type: 6, // USER
      required: true,
    },
    {
      name: 'stat',
      description: 'The stat to get',
      type: 3, // STRING
      required: false,
    },
    {
      name: 'ephemeral',
      description: 'Make the response ephemeral',
      type: 5, // BOOLEAN
      required: false,
    },
  ],
};

export const UPDATE_STATS_COMMAND = {
  name: 'updatestats',
  description: 'Update stats for a user',
  options: [
    {
      name: 'user',
      description: 'The user to update stats for',
      type: 6, // USER
      required: true,
    },
    {
      name: 'stat',
      description: 'The stat to update',
      type: 3, // STRING
      required: true,
    },
    {
      name: 'value',
      description: 'The value to set the stat to',
      type: 4,
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

export const DROP_STATS_COMMAND = {
  name: 'dropstats',
  description: 'Drop stats for a user',
  options: [
    {
      name: 'user',
      description: 'The user to drop stats for',
      type: 6, // USER
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

export const CHECK_MAILBOX_COMMAND = {
  name: 'checkmail',
  description: 'Check your mailbox!',
}

export const SEND_MAIL_COMMAND = {
  name: 'sendmail',
  description: 'Send mail to somebody!',
  options: [
    {
      name: 'user',
      description: 'The user to send mail to',
      type: 6, // USER
      required: false,
    }
  ]
}

export const DELETE_MAIL_COMMAND = {
  name: 'deletemail',
  description: 'Delete mail!',
  options: [
    {
      name: 'index',
      description: 'Which mail to delete',
      type: 4,
      required: false
    }
  ]
}

export const PICK_RANDOM_USER_COMMAND = {
  name: 'choosesomeone',
  description: 'Pick someone random!'
}

export const UPDATE_SETTINGS_COMMAND = {
  name: 'updatesettings',
  description: 'Update your settings for the bot!',
  options: [
    {
      name: 'setting',
      description: 'Which setting to change',
      type: 3,
      required: true
    },
    {
      name: 'value',
      description: 'Which value to change to',
      type: 3,
      required: true
    }
  ]
}

export const GET_SETTINGS_COMMAND = {
  name: 'getsettings',
  description: 'Get your settings for the bot!',
}

export const LENGTHWAVE_COMMAND = {
  name: 'lengthwave',
  description: 'Can you read each other\'s minds?',
  options: [
    {
      name: 'category',
      description: 'What category should be the prompts be from?',
      type: 3,
      required: false
    }
  ]
}