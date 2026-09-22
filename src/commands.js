/**
 * Share command metadata from a common spot to be used for both runtime
 * and registration.
 */

// Where a command is allowed to run.
// integration_types: 0 = installed to a guild, 1 = installed to a user.
// contexts: 0 = guild, 1 = the bot's DMs, 2 = group DMs / other users' DMs.
const GUILD_ONLY = {
  integration_types: [0],
  contexts: [0],
};

// Personal commands: a server, the bot's DMs, or anywhere the user took it.
const ANYWHERE = {
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

export const INVITE_COMMAND = {
  ...ANYWHERE,
  name: 'invite',
  description: 'Get an invite link to add the bot to your server',
};

export const TEST_COMMAND = {
  ...GUILD_ONLY,
  name: 'test',
  description: 'Test command',
};

export const INCREMENT_STATS_COMMAND = {
  ...GUILD_ONLY,
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

export const COINFLIP_COMMAND = {
  ...ANYWHERE,
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
  ...ANYWHERE,
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
  ...ANYWHERE,
  name: 'getstats',
  description: 'Get stats for a user',
  options: [
    {
      name: 'user',
      description: 'The user to get stats for (defaults to you)',
      type: 6, // USER
      required: false,
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
  ...GUILD_ONLY,
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
  ...GUILD_ONLY,
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
  ...ANYWHERE,
  name: 'checkmail',
  description: 'Check your mailbox!',
}

export const SEND_MAIL_COMMAND = {
  ...ANYWHERE,
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
  ...ANYWHERE,
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
  ...GUILD_ONLY,
  name: 'choosesomeone',
  description: 'Pick someone random!'
}

export const READ_MAIL_COMMAND = {
  ...ANYWHERE,
  name: 'readmail',
  description: 'Read one piece of mail in full',
  options: [
    {
      name: 'index',
      description: 'Which mail to read',
      type: 4,
      required: true
    }
  ]
}

export const LEADERBOARD_COMMAND = {
  ...ANYWHERE,
  name: 'leaderboard',
  description: 'Who reads minds best?',
}

export const UPDATE_SETTINGS_COMMAND = {
  ...ANYWHERE,
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
  ...ANYWHERE,
  name: 'getsettings',
  description: 'Get your settings for the bot!',
}

export const LENGTHWAVE_COMMAND = {
  ...ANYWHERE,
  name: 'lengthwave',
  description: 'Can you read each other\'s minds?',
  options: [
    {
      name: 'category',
      description: 'What category should be the prompts be from?',
      type: 3,
      required: false,
      choices: [
        { name: 'base', value: 'base' },
        { name: 'advanced', value: 'advanced' },
      ],
    },
    {
      name: 'left',
      description: 'Left Custom Prompt',
      type: 3,
      required: false
    },
    {
      name: 'right',
      description: 'Right Custom Prompt',
      type: 3,
      required: false
    },
    {
      name: 'position',
      description: 'Value between 0 and 1',
      type: 3,
      required: false
    }
  ]
}

export const EMOTE_COMMAND = {
  ...GUILD_ONLY,
  name: 'emote',
  description: 'borrow an emote from 7tv',
  options: [
    {
      name: 'emote',
      description: 'The emote to borrow',
      type: 3,
      required: true
    },
    {
      name: 'url',
      description: 'The url to the emote',
      type: 3,
      required: true,
    },
  ]
}

export const CHAT_TRACK_COMMAND = {
  ...GUILD_ONLY,
  name: 'chattrack',
  description: 'Track a user\'s chat activity',
  options: [
    {
      name: 'user',
      description: 'The user to track',
      type: 6,
      required: false
    }
  ]
}