import {
  InteractionResponseFlags,
  InteractionResponseType,
} from 'discord-interactions';

export const DISCORD_API = 'https://discord.com/api/v10';

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

/** Interactions from a DM have no `member`; guild interactions have no top-level `user`. */
export function interactionUser(interaction) {
  return interaction.member?.user ?? interaction.user;
}

/**
 * Replace the placeholder Discord showed when we deferred. The interaction
 * token authenticates this, so no bot token is needed.
 */
export function editOriginalResponse(env, interaction, data) {
  return fetch(
    `${DISCORD_API}/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );
}

/**
 * Discord hangs up on an interaction after 3 seconds, which is not enough for
 * anything that makes more than one API call. Acknowledge immediately, run
 * `work` in the background, then edit the placeholder with whatever it returns.
 *
 * `work` resolves to an interaction-callback `data` object ({ content } or
 * { embeds }); throwing surfaces the message to the user.
 */
export async function deferred(env, ctx, interaction, work, ephemeral = false) {
  const task = (async () => {
    try {
      return await editOriginalResponse(env, interaction, await work());
    } catch (err) {
      console.error('deferred work failed:', err);
      return editOriginalResponse(env, interaction, {
        content: `That didn't work: ${err.message}`,
      });
    }
  })();

  if (ctx?.waitUntil) {
    ctx.waitUntil(task);
  } else {
    // No execution context (tests, or a caller that didn't forward one):
    // finish inline so the work still happens.
    await task;
  }

  return new JsonResponse({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: ephemeral ? { flags: InteractionResponseFlags.EPHEMERAL } : {},
  });
}

/**
 * DM someone that mail arrived. The button posts a `check_mailbox` component
 * interaction back to this worker, so they can read it without leaving the DM.
 */
export async function sendMailNotification(recipientId, mail, env) {
  const botToken = env.DISCORD_TOKEN; // you should store your bot token safely in environment variables

  // Step 1: Create a DM channel
  const dmChannelRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
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
  const messageRes = await fetch(`${DISCORD_API}/channels/${dmChannel.id}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      embeds: [
        {
          title: '📬 You have new mail!',
          description: mail?.subject ? `**${mail.subject}**` : undefined,
          color: 0x3498db,
          footer: { text: `From @${mail?.sender ?? 'someone'}` },
          timestamp: mail?.timestamp,
        },
      ],
      components: [
        {
          type: 1, // Action row
          components: [
            {
              type: 2, // Button
              style: 1, // Primary
              label: 'Open mailbox',
              custom_id: 'check_mailbox',
            },
          ],
        },
      ],
    }),
  });

  if (!messageRes.ok) {
    console.error('Failed to send DM message:', await messageRes.text());
    return;
  }

  console.log('Notification sent successfully.');
}
