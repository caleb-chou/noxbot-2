import { avatarUrl } from '../util.js';

export const PROMPTS = {
  base: [
    ['normal', 'weird'],
    ['funny', 'sad'],
    ['hot', 'cold'],
    ['light', 'dark'],
    ['hard', 'soft'],
    ['big', 'small'],
    ['easy', 'difficult'],
    ['cheap', 'expensive'],
  ],
  advanced: [
    ['red flag', 'green flag'],
    ['smash', 'pass'],
    ['rewatchable', 'unwatchable'],
    ['main character', 'bit character'],
    ['worthless', 'worthwhile'],
    ['nightmare', 'daydream'],
    ['person you could beat up', 'person who could beat you up'],
    ['fight', 'flight'],
    ['better together', 'better alone'],
  ],
};

export const ALL_PROMPTS = Object.values(PROMPTS);

const TILES = 20;
const trunc = (x) => Math.trunc(x * 1000) / 1000;
// Tile i is centred on 0.05 * (i + 1); clamp so 0..0.025 still lands on a tile.
const tileOf = (p) => Math.min(TILES - 1, Math.max(0, Math.round(p * TILES) - 1));

/**
 * The gamut as rows of squares. No position → all black (what guessers see).
 * With a guess, the answer row is labelled "Actual" and the guess row marked.
 */
export function gamut(position, guess) {
  let out = '';
  for (let i = 0; i < TILES; i++) {
    // NaN when position is undefined, so every comparison is false → ⬛.
    const d = Math.abs(0.05 * (i + 1) - position);
    let row =
      i === tileOf(position)
        ? `🟦 < ${guess === undefined ? '' : 'Actual '}${trunc(position)}`
        : d < 0.075
          ? '🟧'
          : d < 0.125
            ? '🟨'
            : '⬛';
    if (guess !== undefined && i === tileOf(guess)) {
      row += ` < Your guess ${guess}`;
    }
    if (i % 5 === 4) {
      row += ` < ${(i + 1) * 0.05}`;
    }
    out += `${row}\n`;
  }
  return out;
}

/** A fresh gamut: the ephemeral message for its creator, plus what to store. */
export function generate_message_embed(prompts, position = Math.random()) {
  const [left, right] = prompts[Math.floor(Math.random() * prompts.length)];
  const gameId = crypto.randomUUID();
  const message = {
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
    data: {
      embeds: [
        {
          title: 'Your Gamut!',
          description: `${left}\n${gamut(position)}${right}`,
          color: 0x5865f2,
          footer: { text: gameId },
        },
      ],
      components: [
        {
          type: 1, // Action row
          components: [
            {
              type: 2, // Button
              style: 3, // Success (green)
              label: 'Type Clue',
              custom_id: 'gamut_clue_button',
            },
            {
              type: 2, // Button
              style: 4, // Danger (red)
              label: 'New Gamut',
              custom_id: 'new_gamut_button',
            },
          ],
        },
      ],
      flags: 64,
    },
  };
  return {
    message,
    gameId,
    game_data: { clue: '', prompt: { left, right }, position },
  };
}

export function generate_guesser_message_embed(game_id, game_data, user) {
  const { clue, prompt } = game_data;
  const { left, right } = prompt;

  return {
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
    data: {
      embeds: [
        {
          author: {
            name: `${user.username}'s clue: "${clue}"`,
            icon_url: avatarUrl(user),
          },
          description: `${left}\n${gamut()}${right}`,
          color: 0x5865f2,
          footer: { text: game_id },
        },
      ],
      components: [
        {
          type: 1, // Action row
          components: [
            {
              type: 2, // Button
              style: 3, // Success (green)
              label: 'Guess',
              custom_id: `gamut_guess_button|${game_id}`,
            },
          ],
        },
      ],
    },
  };
}

export function score_guess(game_data, guess) {
  const distance = Math.abs(game_data.position - guess);
  return { distance, score: calculate_score(distance) };
}

export function generate_guess_response_message_embed(
  game_id,
  game_data,
  guess,
  user,
  note = '',
) {
  const { left, right } = game_data.prompt;
  const { distance, score } = score_guess(game_data, guess);

  return {
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
    data: {
      embeds: [
        {
          author: {
            name: `${user.username}'s guess`,
            icon_url: avatarUrl(user),
          },
          description: `||\`\`\`md\n${left}\n${gamut(game_data.position, guess)}${right}\n\n---\n# Your guess was ${guess}\n# Distance: ${trunc(distance)}\n# Score: ${score}${note}\`\`\`||`,
          color: 0x5865f2,
          footer: { text: game_id },
        },
      ],
    },
  };
}

export function calculate_score(distance) {
  if (distance < 0.025) {
    return 4;
  } else if (distance < 0.075) {
    return 3;
  } else if (distance < 0.125) {
    return 2;
  } else {
    return 0;
  }
}

const textModal = (custom_id, title, input) => ({
  type: 9, // InteractionResponseType.MODAL
  data: {
    custom_id,
    title,
    components: [
      {
        type: 1, // Action Row
        components: [
          {
            type: 4, // Text Input
            style: 1, // Short input
            min_length: 1,
            max_length: 100,
            required: true,
            ...input,
          },
        ],
      },
    ],
  },
});

export const createLengthWaveClueModal = (game_id) =>
  textModal(`lengthwave_clue_modal|${game_id}`, 'Type a Clue!', {
    custom_id: 'clue_input',
    label: 'Clue',
    placeholder: 'Enter a clue',
  });

export const createLengthWaveGuessModal = (game_id) =>
  textModal(`lengthwave_guess_modal|${game_id}`, 'Make a Guess!', {
    custom_id: 'guess_input',
    label: 'Guess',
    placeholder: 'Guess the value (0.0-1.0)',
  });
