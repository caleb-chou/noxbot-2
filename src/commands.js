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

// Hidden from everyone without this permission unless a server overrides it.
// The admin commands still check at runtime, since overrides can widen access.
const ADMIN_ONLY = { default_member_permissions: String(1 << 3) }; // ADMINISTRATOR
const EXPRESSION_MANAGERS = { default_member_permissions: String(1 << 30) }; // MANAGE_GUILD_EXPRESSIONS

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
  ...ADMIN_ONLY,
  name: 'incrementuserdata',
  description: 'Add one to a stat for a user',
  options: [
    {
      name: 'user',
      description: 'The user to get data for',
      type: 6, // USER
      required: true,
    },
    {
      name: 'stat',
      description: 'The stat to increment',
      type: 3, // STRING
      required: true,
      autocomplete: true,
    },
    {
      name: 'ephemeral',
      description: 'Make the response ephemeral',
      type: 5, // BOOLEAN
      required: false,
    },
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
      autocomplete: true,
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
  ...ADMIN_ONLY,
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
      autocomplete: true,
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
  ...ADMIN_ONLY,
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
      description: 'Which mail to delete (leave empty to clear all)',
      type: 4,
      required: false,
      min_value: 1,
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
      required: true,
      min_value: 1,
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
      required: true,
      choices: [{ name: 'DM me when mail arrives', value: 'notifyForMail' }],
    },
    {
      name: 'value',
      description: 'Which value to change to',
      type: 3,
      required: true,
      choices: [
        { name: 'on', value: 'true' },
        { name: 'off', value: 'false' },
      ],
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
      type: 10, // NUMBER
      required: false,
      min_value: 0,
      max_value: 1,
    }
  ]
}

export const EMOTE_COMMAND = {
  ...GUILD_ONLY,
  ...EXPRESSION_MANAGERS,
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

export const ROLL_COMMAND = {
  ...ANYWHERE,
  name: 'roll',
  description: 'Roll some dice',
  options: [
    {
      name: 'dice',
      description: 'Like d20, 2d6 or 3d8+2 (default 1d6)',
      type: 3, // STRING
      required: false,
      max_length: 20,
    },
  ],
};

export const REMINDME_COMMAND = {
  ...ANYWHERE,
  name: 'remindme',
  description: 'Get a DM from the bot later',
  options: [
    {
      name: 'in',
      description: 'How long from now, like 10m, 2h30m or 3d',
      type: 3, // STRING
      required: true,
      max_length: 20,
    },
    {
      name: 'text',
      description: 'What to remind you about',
      type: 3, // STRING
      required: true,
      max_length: 1000,
    },
  ],
};

// Right-click menus. Context menu commands have a type and no description.
const USER_MENU = 2;
const MESSAGE_MENU = 3;

export const SEND_MAIL_MENU = {
  ...ANYWHERE,
  type: USER_MENU,
  name: 'Send mail',
};

export const GET_STATS_MENU = {
  ...ANYWHERE,
  type: USER_MENU,
  name: 'Get stats',
};

export const STEAL_EMOJI_MENU = {
  ...GUILD_ONLY,
  ...EXPRESSION_MANAGERS,
  type: MESSAGE_MENU,
  name: 'Steal emoji',
};

export const REMINDERS_COMMAND = {
  ...ANYWHERE,
  name: 'reminders',
  description: 'See your reminders, or cancel one',
};

// The Mind: a cooperative card game played with buttons in a channel.
// Subcommands take no options, so there is no required/optional ordering to trip over.
// Playable in servers, group DMs and DMs between users. Not in the bot's own DM
// (context 1): the bot can't join, so a game there could never reach two players.
export const MIND_COMMAND = {
  integration_types: [0, 1],
  contexts: [0, 2],
  name: 'mind',
  description: 'Play The Mind with friends',
  options: [
    {
      name: 'start',
      description: 'Open a lobby for a new game in this channel',
      type: 1, // SUB_COMMAND
    },
    {
      name: 'end',
      description: 'End the game or lobby in this channel',
      type: 1,
    },
    {
      name: 'leaderboard',
      description: 'See the best Mind teams',
      type: 1,
    },
  ],
};
