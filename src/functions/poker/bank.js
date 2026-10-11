// Ranked poker bankroll rules. Pure: no I/O, so UserData and the table share
// the constants without an import cycle.
export const STARTING_BANKROLL = 5000;
export const DAILY_AMOUNT = 1000;
export const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const DAILY_CEILING = 5000;
export const LEDGER_SIZE = 50;
export const MAX_AMOUNT = 1e9;

export const newBankroll = () => ({
  balance: STARTING_BANKROLL,
  lastDaily: null,
  ledger: [],
  stats: { handsWon: 0, biggestPot: 0, net: 0 },
});

/** An integer within +-MAX_AMOUNT (not a numeric string, not a float). */
export const isAmount = (n) =>
  typeof n === 'number' && Number.isInteger(n) && Math.abs(n) <= MAX_AMOUNT;

/**
 * Apply one op to a bankroll record. Returns { record, duplicate } or
 * { error }. Never mutates its input.
 */
export function applyOp(record, { opId, delta, net, handsWon, biggestPot }) {
  if (typeof opId !== 'string' || !opId || opId.length > 100) {
    return { error: 'Invalid operation id.' };
  }
  if (!isAmount(delta)) {
    return { error: 'Invalid amount.' };
  }
  for (const v of [net, handsWon, biggestPot]) {
    if (v !== undefined && !isAmount(v)) {
      return { error: 'Invalid amount.' };
    }
  }
  if (handsWon < 0 || biggestPot < 0) {
    return { error: 'Invalid amount.' };
  }
  if (record.ledger.includes(opId)) {
    return { record, duplicate: true };
  }
  if (record.balance + delta < 0) {
    return { error: 'Not enough bankroll.' };
  }
  return {
    duplicate: false,
    record: {
      ...record,
      balance: record.balance + delta,
      ledger: [...record.ledger, opId].slice(-LEDGER_SIZE),
      stats: {
        handsWon: record.stats.handsWon + (handsWon ?? 0),
        biggestPot: Math.max(record.stats.biggestPot, biggestPot ?? 0),
        net: record.stats.net + (net ?? 0),
      },
    },
  };
}

/** Daily top-up. Returns { record } or { error, remainingMs? }. */
export function claimDaily(record, now) {
  if (!Number.isFinite(now)) {
    return { error: 'Invalid time.' };
  }
  if (record.balance >= DAILY_CEILING) {
    return { error: `Daily is only for bankrolls under $${DAILY_CEILING}.` };
  }
  const wait =
    record.lastDaily == null ? 0 : record.lastDaily + DAILY_COOLDOWN_MS - now;
  if (wait > 0) {
    return { error: 'Daily already claimed.', remainingMs: wait };
  }
  return {
    record: { ...record, balance: record.balance + DAILY_AMOUNT, lastDaily: now },
  };
}
