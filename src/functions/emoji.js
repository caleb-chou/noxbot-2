import { DISCORD_API } from '../util.js';

const SEVENTV_API = 'https://7tv.io/v3/emotes';
// Discord only accepts PNG/JPEG/GIF emoji, max 256 KiB.
const DISCORD_MIME = { PNG: 'image/png', GIF: 'image/gif' };
const MAX_EMOJI_BYTES = 256 * 1024;

/**
 * Resolve a 7tv emote page/CDN url to a data: uri Discord will actually accept.
 * 7tv serves png for static emotes and gif for animated ones (plus webp/avif,
 * which Discord rejects), so ask the API which files exist rather than guessing.
 */
export async function image_to_buffer(url) {
  const id = new URL(url).pathname.split('/').filter(Boolean).pop();

  const metaRes = await fetch(`${SEVENTV_API}/${id}`);
  if (!metaRes.ok) {
    throw new Error(`no 7tv emote with id "${id}"`);
  }
  const { host } = await metaRes.json();

  const file = (host.files ?? [])
    .filter((f) => DISCORD_MIME[f.format] && f.size <= MAX_EMOJI_BYTES)
    .sort((a, b) => b.size - a.size)[0];

  if (!file) {
    throw new Error('no png/gif version of that emote fits under 256 KiB');
  }

  const imgRes = await fetch(`https:${host.url}/${file.name}`);
  if (!imgRes.ok) {
    throw new Error(`7tv returned ${imgRes.status} for ${file.name}`);
  }

  const b64 = arrayBufferToBase64(await imgRes.arrayBuffer());
  return `data:${DISCORD_MIME[file.format]};base64,${b64}`;
}

const CUSTOM_EMOJI = /<(a?):(\w{2,32}):(\d+)>/;

/**
 * The first custom emoji in a message, as { name, data } ready for add_emoji.
 * Discord's own emoji are already under its size limit, so no checks needed.
 */
export async function stealEmoji(content) {
  const match = CUSTOM_EMOJI.exec(content ?? '');
  if (!match) {
    throw new Error('that message has no custom emoji');
  }
  const [, animated, name, id] = match;
  const ext = animated ? 'gif' : 'png';

  const res = await fetch(`https://cdn.discordapp.com/emojis/${id}.${ext}`);
  if (!res.ok) {
    throw new Error(`Discord's CDN returned ${res.status} for :${name}:`);
  }
  const b64 = arrayBufferToBase64(await res.arrayBuffer());
  return { name, data: `data:image/${ext};base64,${b64}` };
}

/** Upload an emoji to a server; throws a user-facing message if Discord refuses. */
export async function add_emoji(token, guildId, name, image_data) {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/emojis`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, image: image_data }),
  });
  if (!res.ok) {
    console.error('add_emoji failed:', res.status, await res.text());
    throw new Error(`Discord rejected it (${res.status})`);
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked: String.fromCharCode(...bytes) blows the stack at this size.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
