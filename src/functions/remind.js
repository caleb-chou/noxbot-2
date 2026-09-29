const UNIT_MS = { w: 604_800_000, d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 };
const DURATION = /^(\s*\d+\s*[wdhms])+\s*$/i;

export const MIN_REMINDER_MS = 60_000;
export const MAX_REMINDER_MS = 365 * UNIT_MS.d;
export const MAX_REMINDERS = 25;

/** "1d2h", "90m", "2h 30m" → milliseconds, or NaN if it doesn't parse. */
export function parseDuration(text) {
  if (!DURATION.test(text ?? '')) {
    return NaN;
  }
  let ms = 0;
  for (const [, n, unit] of text.matchAll(/(\d+)\s*([wdhms])/gi)) {
    ms += Number(n) * UNIT_MS[unit.toLowerCase()];
  }
  return ms;
}

export function reminderMessage(reminder) {
  return {
    embeds: [
      {
        title: '⏰ Reminder',
        description: reminder.text,
        color: 0xf1c40f,
        footer: { text: 'Set' },
        timestamp: new Date(reminder.createdAt).toISOString(),
      },
    ],
  };
}

const truncate = (text, max) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * The /reminders list, plus a dropdown to cancel one. Also used to redraw the
 * list in place after a cancel, so an empty list clears the embed and menu.
 */
export function remindersListMessage(reminders) {
  if (reminders.length === 0) {
    return { content: 'No reminders waiting. Set one with `/remindme`.', embeds: [], components: [] };
  }
  return {
    content: '',
    embeds: [
      {
        title: '⏰ Your reminders',
        description: reminders
          .map(
            (r, i) =>
              `${i + 1}. <t:${Math.floor(r.at / 1000)}:R> — ${truncate(r.text, 100)}`,
          )
          .join('\n'),
        color: 0xf1c40f,
      },
    ],
    components: [
      {
        type: 1, // Action row
        components: [
          {
            type: 3, // String select; MAX_REMINDERS keeps this within its 25 options
            custom_id: 'cancel_reminder',
            placeholder: 'Cancel a reminder…',
            options: reminders.map((r, i) => ({
              label: truncate(`${i + 1}. ${r.text}`, 100),
              value: r.id,
            })),
          },
        ],
      },
    ],
  };
}
