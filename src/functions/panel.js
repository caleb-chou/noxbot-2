// Shared by the game Durable Objects: redraw a panel message out of band.
// The bot token works wherever the bot can see the channel; elsewhere (group
// DMs, user-installed use) fall back to the interaction token of the last click,
// which Discord honours for 15 minutes.
import { DISCORD_API } from '../util.js';

export const PANEL_TOKEN = 'panelToken';
export const TOKEN_MS = 14 * 60_000;

/** Remember the interaction token of the latest click on the panel. */
export async function rememberToken(storage, token, now) {
  if (token) {
    await storage.put(PANEL_TOKEN, { token, at: now });
  }
}

async function patch(url, headers, message) {
  return fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(message),
  });
}

/**
 * Edit the panel. Returns 'ok', 'gone' (deleted and no way left to try) or
 * 'failed'. Never throws. `label` prefixes log lines.
 */
export async function editPanel({ env, storage, channelId, messageId, message, label }) {
  if (!messageId) {
    return 'failed';
  }
  try {
    const bot = await patch(
      `${DISCORD_API}/channels/${channelId}/messages/${messageId}`,
      { Authorization: `Bot ${env.DISCORD_TOKEN}` },
      message,
    );
    if (bot.ok) {
      return 'ok';
    }
    const saved = await storage.get(PANEL_TOKEN);
    if (saved && Date.now() - saved.at < TOKEN_MS) {
      const hook = await patch(
        `${DISCORD_API}/webhooks/${env.DISCORD_APPLICATION_ID}/${saved.token}/messages/@original`,
        {},
        message,
      );
      if (hook.ok) {
        return 'ok';
      }
      console.error(`${label} panel edit failed:`, hook.status, await hook.text());
      return 'failed';
    }
    if (bot.status === 404) {
      return 'gone';
    }
    console.error(`${label} panel edit failed:`, bot.status, await bot.text());
    return 'failed';
  } catch (err) {
    console.error(`${label} panel edit failed:`, err);
    return 'failed';
  }
}

/** Post a new message with the bot token, best effort. */
export async function postMessage({ env, channelId, message, label }) {
  try {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${env.DISCORD_TOKEN}`,
      },
      body: JSON.stringify(message),
    });
    if (!res.ok) {
      console.error(`${label} post failed:`, res.status);
    }
  } catch (err) {
    console.error(`${label} post failed:`, err);
  }
}
