// The Mind: pure game logic and message builders. No I/O, so it is easy to test.
// Every transition takes a state and returns `{ state, events }` without
// mutating its input, or `{ error }` (no state change) when the move is refused.

export const IDLE_MS = 30 * 60_000;
export const VOTE_MS = 60_000;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const MAX_LIVES = 5;
export const MAX_SHURIKENS = 3;
export const DECK_SIZE = 100;
const PILE_SHOWN = 10;

const LEVELS = { 2: 12, 3: 10, 4: 8, 5: 7, 6: 6, 7: 5, 8: 5 };
const SHURIKEN_LEVELS = [2, 5, 8];
const LIFE_LEVELS = [3, 6, 9];

export const levelsFor = (playerCount) => LEVELS[playerCount];

/** Rewards granted for clearing `level`, before caps are applied. */
export function rewardsFor(level) {
  return {
    shurikens: SHURIKEN_LEVELS.includes(level) ? 1 : 0,
    lives: LIFE_LEVELS.includes(level) ? 1 : 0,
  };
}

/** A float in [0, 1) from crypto.getRandomValues. */
export function cryptoRng() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

/** Fisher-Yates. `rng` returns a float in [0, 1) so tests can be deterministic. */
export function shuffle(items, rng = cryptoRng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const clone = (state) => structuredClone(state);
const fail = (error) => ({ error });
const mention = (id) => `<@${id}>`;

const GAME_OVER = 'This game is over.';
const NOT_PLAYING = 'There is no level in progress.';

/** Players who still hold cards, i.e. everyone a shuriken vote needs. */
const voters = (state) => state.players.filter((p) => state.hands[p].length > 0);

/** An expired vote is dropped the next time anyone touches the game. */
function dropExpiredVote(state, now) {
  if (state.vote && now >= state.vote.expires) {
    state.vote = null;
    state.status = 'The shuriken vote timed out.';
  }
}

/** Deal a fresh shuffled deck: `level` unique cards per player, sorted. */
function deal(state, level, rng) {
  const deck = shuffle(
    Array.from({ length: DECK_SIZE }, (_, i) => i + 1),
    rng,
  );
  state.level = level;
  state.maxLevelReached = Math.max(state.maxLevelReached, level);
  state.hands = {};
  state.players.forEach((p, i) => {
    state.hands[p] = deck.slice(i * level, (i + 1) * level).sort((a, b) => a - b);
  });
  state.pile = [];
  state.vote = null;
  state.lastMistake = null;
  state.lastShuriken = null;
  state.phase = 'playing';
}

/**
 * After any card leaves a hand: lose on 0 lives, otherwise clear the level once
 * every hand is empty (win on the last level, else grant rewards and pause).
 */
function settle(state, events) {
  if (state.lives <= 0) {
    state.phase = 'lost';
    state.vote = null;
    state.status = 'Out of lives. The team loses.';
    events.push({ type: 'lost', reason: 'lives' });
    return;
  }
  if (voters(state).length > 0) {
    return;
  }
  const rewards = rewardsFor(state.level);
  const gained = {
    // Never negative: 6-8 players start above the cap and keep their extra lives.
    shurikens: Math.max(0, Math.min(MAX_SHURIKENS, state.shurikens + rewards.shurikens) - state.shurikens),
    lives: Math.max(0, Math.min(MAX_LIVES, state.lives + rewards.lives) - state.lives),
  };
  state.shurikens += gained.shurikens;
  state.lives += gained.lives;
  state.vote = null;
  events.push({ type: 'level_cleared', level: state.level, rewards: gained });
  if (state.level >= state.totalLevels) {
    state.phase = 'won';
    state.status = 'Every level cleared. The team wins!';
    events.push({ type: 'won' });
    return;
  }
  state.phase = 'between';
  const parts = [];
  if (gained.shurikens) parts.push(`+${gained.shurikens} ⭐`);
  if (gained.lives) parts.push(`+${gained.lives} ❤️`);
  state.status = `Level ${state.level} cleared!${parts.length ? ` ${parts.join(' ')}` : ''}`;
}

export function newLobby({ hostId, channelId, guildId, now }) {
  return {
    phase: 'lobby',
    hostId,
    messageId: null,
    channelId,
    guildId,
    players: [hostId],
    level: 0,
    totalLevels: 0,
    lives: 0,
    shurikens: 0,
    hands: {},
    pile: [],
    vote: null,
    lastMistake: null,
    lastShuriken: null,
    status: '',
    endReason: null,
    updatedAt: now,
    startedAt: null,
    maxLevelReached: 0,
  };
}

export function join(state, userId, now) {
  if (state.phase !== 'lobby') {
    return fail('This game has already started.');
  }
  if (state.players.includes(userId)) {
    return fail('You are already in this game.');
  }
  if (state.players.length >= MAX_PLAYERS) {
    return fail(`The lobby is full (${MAX_PLAYERS} players).`);
  }
  const next = clone(state);
  next.players.push(userId);
  next.updatedAt = now;
  return { state: next, events: [{ type: 'joined', userId }] };
}

export function leave(state, userId, now) {
  if (state.phase !== 'lobby') {
    return fail('You cannot leave once the game has started. Use `/mind end`.');
  }
  if (!state.players.includes(userId)) {
    return fail('You are not in this game.');
  }
  if (userId === state.hostId) {
    return fail('The host cannot leave. Cancel the lobby instead.');
  }
  const next = clone(state);
  next.players = next.players.filter((p) => p !== userId);
  next.updatedAt = now;
  return { state: next, events: [{ type: 'left', userId }] };
}

export function begin(state, userId, now, rng = cryptoRng) {
  if (state.phase !== 'lobby') {
    return fail('This game has already started.');
  }
  if (userId !== state.hostId) {
    return fail('Only the host can begin the game.');
  }
  if (state.players.length < MIN_PLAYERS) {
    return fail(`You need at least ${MIN_PLAYERS} players to begin.`);
  }
  const next = clone(state);
  next.totalLevels = levelsFor(next.players.length);
  next.lives = next.players.length;
  next.shurikens = 1;
  next.startedAt = now;
  next.updatedAt = now;
  next.status = 'Level 1. Stay silent and play when you feel it.';
  deal(next, 1, rng);
  return { state: next, events: [{ type: 'started', level: 1 }] };
}

export function playLowest(state, userId, now) {
  if (state.phase !== 'playing') {
    return fail(state.phase === 'between' ? NOT_PLAYING : GAME_OVER);
  }
  if (!state.players.includes(userId)) {
    return fail('You are not in this game.');
  }
  const next = clone(state);
  dropExpiredVote(next, now);
  if (next.vote) {
    return fail('A shuriken vote is open. Resolve it first.');
  }
  if (next.hands[userId].length === 0) {
    return fail('You have no cards left.');
  }
  const played = next.hands[userId].shift();
  const events = [{ type: 'played', userId, card: played }];
  next.pile.push(played);
  next.lastShuriken = null;
  next.updatedAt = now;

  // Anyone still holding something lower means the play was out of order.
  const discarded = [];
  for (const p of next.players) {
    const keep = [];
    for (const c of next.hands[p]) {
      (c < played ? discarded : keep).push(c);
    }
    next.hands[p] = keep;
  }
  if (discarded.length > 0) {
    discarded.sort((a, b) => a - b);
    next.lives -= 1;
    next.lastMistake = { played, discarded };
    next.status = `${mention(userId)} played ${played} too early. Lost a life.`;
    events.push({ type: 'mistake', played, discarded });
  } else {
    next.lastMistake = null;
    next.status = `${mention(userId)} played ${played}.`;
  }
  settle(next, events);
  return { state: next, events };
}

/** Everyone who must agree has said yes: spend the shuriken and reveal. */
function resolveShuriken(state, now, events) {
  const discarded = {};
  for (const p of voters(state)) {
    discarded[p] = state.hands[p].shift();
  }
  state.shurikens -= 1;
  state.vote = null;
  state.lastMistake = null;
  state.lastShuriken = { discarded };
  state.updatedAt = now;
  state.status = 'Shuriken thrown. Everyone discarded their lowest card.';
  events.push({ type: 'shuriken', discarded });
  settle(state, events);
}

export function startVote(state, userId, now) {
  if (state.phase !== 'playing') {
    return fail(state.phase === 'between' ? NOT_PLAYING : GAME_OVER);
  }
  if (!state.players.includes(userId)) {
    return fail('You are not in this game.');
  }
  const next = clone(state);
  dropExpiredVote(next, now);
  if (next.vote) {
    return fail('A shuriken vote is already open.');
  }
  if (next.shurikens < 1) {
    return fail('There are no shurikens left.');
  }
  if (next.hands[userId].length === 0) {
    return fail('You have no cards left, so you cannot throw.');
  }
  next.vote = { by: userId, yes: [userId], expires: now + VOTE_MS };
  next.updatedAt = now;
  next.status = `${mention(userId)} wants to throw a shuriken.`;
  const events = [{ type: 'vote_started', by: userId }];
  if (voters(next).every((p) => next.vote.yes.includes(p))) {
    resolveShuriken(next, now, events);
  }
  return { state: next, events };
}

export function castVote(state, userId, agree, now) {
  if (state.phase !== 'playing' || !state.vote) {
    return fail('There is no shuriken vote open.');
  }
  const next = clone(state);
  if (now >= next.vote.expires) {
    next.vote = null;
    next.status = 'The shuriken vote timed out.';
    next.updatedAt = now;
    return { state: next, events: [{ type: 'vote_expired' }] };
  }
  if (!voters(next).includes(userId)) {
    return fail('Only players holding cards can vote.');
  }
  next.updatedAt = now;
  if (!agree) {
    next.vote = null;
    next.status = `${mention(userId)} declined. No shuriken thrown.`;
    return { state: next, events: [{ type: 'vote_declined', by: userId }] };
  }
  if (!next.vote.yes.includes(userId)) {
    next.vote.yes.push(userId);
  }
  const events = [{ type: 'vote_cast', userId, agree }];
  if (voters(next).every((p) => next.vote.yes.includes(p))) {
    resolveShuriken(next, now, events);
  }
  return { state: next, events };
}

export function nextLevel(state, now, rng = cryptoRng) {
  if (state.phase !== 'between') {
    return fail('There is no level to advance from.');
  }
  const next = clone(state);
  next.updatedAt = now;
  deal(next, next.level + 1, rng);
  next.status = `Level ${next.level}.`;
  return { state: next, events: [{ type: 'level_started', level: next.level }] };
}

/** reason: 'ended' (a player used /mind end) or 'timeout' (idle alarm). */
export function endGame(state, reason, now) {
  if (!['lobby', 'playing', 'between'].includes(state.phase)) {
    return fail(GAME_OVER);
  }
  const next = clone(state);
  const wasLobby = next.phase === 'lobby';
  next.phase = 'ended';
  next.endReason = reason;
  next.vote = null;
  next.updatedAt = now;
  next.status =
    reason === 'timeout'
      ? 'The game timed out from inactivity.'
      : wasLobby
        ? 'The lobby was cancelled.'
        : 'The game was ended early.';
  const event = wasLobby
    ? { type: 'cancelled', reason }
    : { type: 'lost', reason };
  return { state: next, events: [event] };
}

/**
 * What the stats writer records. A game that never left the lobby has no
 * players to credit, so it returns an empty list.
 */
export function statsFor(state) {
  const started = state.startedAt !== null && state.startedAt !== undefined;
  return {
    players: started ? [...state.players] : [],
    won: state.phase === 'won',
    bestLevel: state.maxLevelReached,
  };
}

// ---- Message builders -------------------------------------------------------

const COLOR = 0x5865f2;
const ACTION_ROW = 1;
const BUTTON = 2;
const PRIMARY = 1;
const SECONDARY = 2;
const SUCCESS = 3;
const DANGER = 4;

const button = (state, action, label, style, extra = {}) => ({
  type: BUTTON,
  style,
  label,
  custom_id: `mind_${action}|${state.channelId}${extra.suffix ?? ''}`,
  ...(extra.disabled ? { disabled: true } : {}),
});

const row = (...components) => ({ type: ACTION_ROW, components });

const icons = (n, icon) => (n > 0 ? icon.repeat(n) : '—');

function playerLines(state) {
  return state.players
    .map((p) => {
      const n = state.hands[p]?.length ?? 0;
      return `${mention(p)}: ${n} card${n === 1 ? '' : 's'}`;
    })
    .join('\n');
}

/** The last few cards, truncating the left so the newest always shows. */
function pileLine(state) {
  if (state.pile.length === 0) {
    return 'Empty';
  }
  const shown = state.pile.slice(-PILE_SHOWN).join(' → ');
  return state.pile.length > PILE_SHOWN ? `… → ${shown}` : shown;
}

export function lobbyMessage(state) {
  const ended = state.phase !== 'lobby';
  const lines = state.players.map(
    (p) => `${mention(p)}${p === state.hostId ? ' (host)' : ''}`,
  );
  return {
    embeds: [
      {
        title: '🧠 The Mind',
        description: [
          'Play every card in ascending order without talking.',
          '',
          `**Players (${state.players.length}/${MAX_PLAYERS})**`,
          ...lines,
          ...(state.status && ended ? ['', state.status] : []),
        ].join('\n'),
        color: COLOR,
        footer: { text: `${MIN_PLAYERS}-${MAX_PLAYERS} players. The host presses Begin.` },
      },
    ],
    components: ended
      ? []
      : [
          row(
            button(state, 'join', 'Join', SUCCESS, { disabled: state.players.length >= MAX_PLAYERS }),
            button(state, 'leave', 'Leave', SECONDARY),
            button(state, 'begin', 'Begin', PRIMARY, { disabled: state.players.length < MIN_PLAYERS }),
            button(state, 'cancel', 'Cancel', DANGER),
          ),
        ],
  };
}

/** The shared panel while a vote is open: panel embeds plus the vote and Agree/Decline buttons. */
export function voteMessage(state) {
  const needed = voters(state);
  const waiting = needed.filter((p) => !state.vote.yes.includes(p));
  const panel = panelEmbeds(state);
  panel.push({
    title: '⭐ Shuriken vote',
    description: [
      `${mention(state.vote.by)} wants to throw a shuriken. Everyone discards their lowest card.`,
      `Waiting on: ${waiting.map(mention).join(' ') || 'nobody'}`,
      `Ends <t:${Math.floor(state.vote.expires / 1000)}:R>`,
    ].join('\n'),
    color: 0xf1c40f,
  });
  return {
    embeds: panel,
    components: [
      row(
        button(state, 'vote', 'Agree', SUCCESS, { suffix: '|yes' }),
        button(state, 'vote', 'Decline', DANGER, { suffix: '|no' }),
      ),
    ],
  };
}

function panelEmbeds(state) {
  const fields = [
    { name: 'Lives', value: icons(state.lives, '❤️'), inline: true },
    { name: 'Shurikens', value: icons(state.shurikens, '⭐'), inline: true },
    { name: 'Players', value: playerLines(state) },
    { name: 'Pile', value: pileLine(state) },
  ];
  if (state.lastMistake) {
    fields.push({
      name: 'Missed',
      value: state.lastMistake.discarded.join(', '),
    });
  }
  if (state.lastShuriken) {
    fields.push({
      name: 'Shuriken',
      value: Object.entries(state.lastShuriken.discarded)
        .map(([p, c]) => `${mention(p)}: ${c}`)
        .join('\n'),
    });
  }
  return [
    {
      title: `🧠 The Mind: level ${state.level} / ${state.totalLevels}`,
      description: state.status || undefined,
      color: COLOR,
      fields,
    },
  ];
}

export function panelMessage(state) {
  if (state.phase === 'lobby' || state.startedAt == null) {
    return lobbyMessage(state);
  }
  if (state.phase === 'playing' && state.vote) {
    return voteMessage(state);
  }
  let components = [];
  if (state.phase === 'playing') {
    components = [
      row(
        button(state, 'play', 'Play lowest', PRIMARY),
        button(state, 'hand', 'My hand', SECONDARY),
        button(state, 'shuriken', 'Throw shuriken', SECONDARY, { disabled: state.shurikens < 1 }),
      ),
    ];
  } else if (state.phase === 'between') {
    components = [row(button(state, 'next', 'Next level', SUCCESS))];
  }
  return { embeds: panelEmbeds(state), components };
}

/** Ephemeral reply listing one player's remaining cards. */
export function handMessage(state, userId) {
  if (!state.players.includes(userId)) {
    return { content: 'You are not in this game.', flags: 64 };
  }
  const hand = state.hands[userId] ?? [];
  return {
    content: hand.length
      ? `Your hand: **${hand.join(', ')}**`
      : 'You have no cards left.',
    flags: 64,
  };
}
