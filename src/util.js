import {
  InteractionResponseFlags,
  InteractionResponseType,
} from 'discord-interactions';

export const DISCORD_API = 'https://discord.com/api/v10';

/** Interactions from a DM have no `member`; guild interactions have no top-level `user`. */
export function interactionUser(interaction) {
  return interaction.member?.user ?? interaction.user;
}

/** Value of a slash-command option, or undefined. */
export const opt = (interaction, name) =>
  interaction.data.options?.find((o) => o.name === name)?.value;

export const avatarUrl = (user) =>
  user?.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
    : undefined;

/** Run `promise` after the response is sent; inline when there's no ctx (tests). */
export async function background(ctx, promise) {
  if (ctx?.waitUntil) {
    ctx.waitUntil(promise);
  } else {
    await promise;
  }
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
  await background(
    ctx,
    (async () => {
      try {
        return await editOriginalResponse(env, interaction, await work());
      } catch (err) {
        console.error('deferred work failed:', err);
        return editOriginalResponse(env, interaction, {
          content: `That didn't work: ${err.message}`,
        });
      }
    })(),
  );

  return Response.json({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: ephemeral ? { flags: InteractionResponseFlags.EPHEMERAL } : {},
  });
}

/** DM a user. Logs and returns false on failure (e.g. their DMs are closed). */
export async function sendDM(env, userId, message) {
  const headers = {
    Authorization: `Bot ${env.DISCORD_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const dmChannelRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ recipient_id: userId }),
  });
  if (!dmChannelRes.ok) {
    console.error('Failed to create DM channel:', await dmChannelRes.text());
    return false;
  }

  const dmChannel = await dmChannelRes.json();
  const messageRes = await fetch(`${DISCORD_API}/channels/${dmChannel.id}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
  });
  if (!messageRes.ok) {
    console.error('Failed to send DM message:', await messageRes.text());
    return false;
  }
  return true;
}

/**
 * DM someone that mail arrived. The button posts a `check_mailbox` component
 * interaction back to this worker, so they can read it without leaving the DM.
 */
export function sendMailNotification(recipientId, mail, env) {
  return sendDM(env, recipientId, {
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
  });
}
