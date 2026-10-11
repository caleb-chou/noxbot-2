// Poker table configuration: defaults, blind ladder parsing and validation.

export const DEFAULT_LADDER_TEXT = '1/2,2/4,3/6,5/10,10/20,15/30,25/50,50/100';
export const MAX_LADDER_LEVELS = 12;
// Keeps every pot far below 2^53 so chip arithmetic stays exact (9 seats x 1e9),
// and matches the bankroll's own per-operation cap.
export const MAX_CHIPS = 1_000_000_000;

/**
 * Parse "1/2, 2/4" into [{small, big}]. Throws an Error with a user-facing
 * message on bad input.
 */
export function parseLadder(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Blinds must look like 1/2,2/4,5/10.');
  }
  const levels = [];
  for (const part of text.split(',').map((p) => p.trim())) {
    const m = /^(\d+)\s*\/\s*(\d+)$/.exec(part);
    if (!m) {
      throw new Error(
        `"${part}" is not a blind level. Use whole numbers as small/big, like 1/2.`,
      );
    }
    const small = Number(m[1]);
    const big = Number(m[2]);
    if (!Number.isSafeInteger(small) || !Number.isSafeInteger(big) || small < 1) {
      throw new Error(`"${part}": blinds must be whole numbers of at least 1.`);
    }
    if (big > MAX_CHIPS) {
      throw new Error(`"${part}": blinds can be at most ${MAX_CHIPS}.`);
    }
    if (small >= big) {
      throw new Error(`"${part}": the small blind must be less than the big blind.`);
    }
    const prev = levels[levels.length - 1];
    if (prev && big <= prev.big) {
      throw new Error(
        `"${part}": each level's big blind must be higher than the one before it.`,
      );
    }
    levels.push({ small, big });
  }
  if (levels.length > MAX_LADDER_LEVELS) {
    throw new Error(`Use at most ${MAX_LADDER_LEVELS} blind levels.`);
  }
  return levels;
}

const isInt = (v) => Number.isInteger(v);

/**
 * Turn the /poker start options object into a table config.
 * Returns { config } or { error }.
 */
export function parseTableConfig(options) {
  const o = options ?? {};
  const pick = (key, def) => (o[key] === undefined || o[key] === null ? def : o[key]);

  const variant = pick('variant', 'holdem');
  if (variant !== 'holdem' && variant !== 'plo') {
    return { error: 'Variant must be holdem or plo.' };
  }
  const mode = pick('mode', 'casual');
  if (mode !== 'casual' && mode !== 'ranked') {
    return { error: 'Mode must be casual or ranked.' };
  }

  const seats = pick('seats', 6);
  if (!isInt(seats) || seats < 2 || seats > 9) {
    return { error: 'Seats must be a whole number from 2 to 9.' };
  }

  let ladder;
  try {
    ladder = parseLadder(pick('blinds', DEFAULT_LADDER_TEXT));
  } catch (e) {
    return { error: e.message };
  }

  const buyin = pick('buyin', 500);
  if (!isInt(buyin) || buyin < 1) {
    return { error: 'Buy-in must be a whole number of at least 1.' };
  }
  const buyinMin = pick('buyin_min', buyin);
  const buyinMax = pick('buyin_max', buyin);
  if (!isInt(buyinMin) || !isInt(buyinMax)) {
    return { error: 'Buy-in limits must be whole numbers.' };
  }
  if ([buyin, buyinMin, buyinMax].some((v) => v > MAX_CHIPS)) {
    return { error: `Buy-ins can be at most $${MAX_CHIPS}.` };
  }
  if (buyinMin < ladder[0].big) {
    return {
      error: `The minimum buy-in must be at least one big blind ($${ladder[0].big}).`,
    };
  }
  if (buyinMin > buyin) {
    return { error: 'buyin_min cannot be higher than the buy-in.' };
  }
  if (buyinMax < buyin) {
    return { error: 'buyin_max cannot be lower than the buy-in.' };
  }

  const maxRebuys = pick('max_rebuys', mode === 'ranked' ? 3 : null);
  if (maxRebuys !== null && (!isInt(maxRebuys) || maxRebuys < 0)) {
    return { error: 'max_rebuys must be a whole number of 0 or more.' };
  }

  const escalateEvery = pick('escalate_every', 10);
  if (!isInt(escalateEvery) || escalateEvery < 1) {
    return { error: 'escalate_every must be a whole number of at least 1.' };
  }

  const timer = pick('timer', 60);
  if (!isInt(timer) || timer < 15 || timer > 300) {
    return { error: 'Timer must be between 15 and 300 seconds.' };
  }

  return {
    config: {
      variant,
      mode,
      seats,
      buyin,
      buyinMin,
      buyinMax,
      rebuys: Boolean(pick('rebuys', true)),
      maxRebuys,
      escalate: Boolean(pick('escalate', false)),
      escalateEvery,
      timer,
      ping: Boolean(pick('ping', true)),
      ladder,
    },
  };
}

/** Index into config.ladder for the given number of hands already played. */
export function ladderLevel(config, handsPlayed) {
  if (!config.escalate) return 0;
  const hands = Math.max(0, Math.floor(handsPlayed) || 0);
  return Math.min(Math.floor(hands / config.escalateEvery), config.ladder.length - 1);
}

/** Current blind pair ({small, big}) for the given number of hands played. */
export function currentBlinds(config, handsPlayed) {
  return config.ladder[ladderLevel(config, handsPlayed)];
}
