// Poker message builders. Pure: state in, Discord payloads out.
//
// PRIVACY: public builders (tableMessage, turnPing, showdownMessage,
// rulesMessage, ...) never read seat.hole or state.deck. Only handMessage does,
// and only for the viewer's own seat. showdownMessage prints cards only for
// players listed in lastHand.results with `cards` set while lastHand.showdown.
//
// Builders return plain payloads ({ embeds, components } / { content, flags })
// that the server wraps; raiseModal and sitModal return a full type 9 response.

import { formatCard, formatCards, parseCard } from './cards.js';
import { rank5, combos, compareHands, handName, CATEGORIES } from './evaluate.js';
import { currentBlinds } from './config.js';
import { legalActions, potTotal } from './game.js';

const COLOR = 0x1f8b4c;
const COLOR_GOLD = 0xf1c40f;
const COLOR_GREY = 0x95a5a6;
const ACTION_ROW = 1;
const BUTTON = 2;
const PRIMARY = 1;
const SECONDARY = 2;
const SUCCESS = 3;
const DANGER = 4;
const EPHEMERAL = 64;

export const mention = (id) => `<@${id}>`;

/** 1234567 -> "$1,234,567". */
export function money(n) {
  const v = Math.round(Number(n) || 0);
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US')}`;
}

/** Keep text within `max` chars, ending with an ellipsis when cut. */
export function truncate(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

const ts = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

const button = (state, action, label, style, disabled = false) => ({
  type: BUTTON,
  style,
  label,
  custom_id: `pk_${action}|${state.channelId}`,
  ...(disabled ? { disabled: true } : {}),
});

const row = (...components) => ({ type: ACTION_ROW, components });

const seatIndex = (state, userId) =>
  state.seats.findIndex((s) => s && s.userId === userId);

const seated = (state) => state.seats.filter(Boolean);

/** Total chips in the middle: committed this hand (includes folded players). */
export function potOf(state) {
  return potTotal(state);
}

const variantName = (config) =>
  config.variant === 'plo' ? 'Pot-Limit Omaha' : "No-Limit Hold'em";

function boardText(board) {
  if (!board || board.length === 0) return '—';
  const parts = [formatCards(board.slice(0, 3))];
  if (board.length > 3) parts.push(formatCard(board[3]));
  if (board.length > 4) parts.push(formatCard(board[4]));
  return parts.join(' | ');
}

const STREETS = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };

function headerLine(state) {
  const c = state.config;
  const b = state.blinds ?? currentBlinds(c, Math.max(0, (state.handNumber ?? 1) - 1));
  const mode = c.mode === 'ranked' ? 'Ranked' : 'Casual';
  return `${variantName(c)} · ${mode} · Blinds ${money(b.small)}/${money(b.big)}`;
}

/** Blind positions, derived from the button and who was dealt in (state has no sb/bb fields). */
function blindSeats(state) {
  const n = state.seats.length;
  if (state.button == null) return {};
  const dealt = [];
  for (let k = 1; k <= n; k++) {
    const i = (state.button + k) % n;
    const s = state.seats[i];
    if (s && s.status !== 'waiting') dealt.push(i);
  }
  if (dealt.length < 2) return {};
  if (dealt.length === 2) return { sb: state.button, bb: dealt.find((i) => i !== state.button) };
  return { sb: dealt[0], bb: dealt[1] };
}

function seatTags(state, i, s, blinds) {
  const tags = [];
  if (state.button === i) tags.push('**D**');
  if (blinds.sb === i) tags.push('SB');
  if (blinds.bb === i) tags.push('BB');
  if (s.status === 'folded') tags.push('folded');
  if (s.status === 'allin') tags.push('ALL-IN');
  if (s.sittingOut) tags.push('sitting out');
  if (s.leaving) tags.push('leaving');
  return tags;
}

function seatLine(state, i, s, inHand, blinds) {
  const tags = seatTags(state, i, s, blinds);
  const arrow = inHand && state.toAct === i ? '▶ ' : '';
  const bet = inHand && s.bet > 0 ? ` · bet ${money(s.bet)}` : '';
  const t = tags.length ? ` [${tags.join(', ')}]` : '';
  return `${arrow}\`${i + 1}\` ${mention(s.userId)} ${money(s.stack)}${bet}${t}`;
}

function seatsField(state, inHand) {
  const blinds = inHand ? blindSeats(state) : {};
  const lines = state.seats.map((s, i) =>
    s ? seatLine(state, i, s, inHand, blinds) : `\`${i + 1}\` *empty*`,
  );
  return { name: 'Seats', value: truncate(lines.join('\n'), 1024) };
}

function lastHandLines(state) {
  const lh = state.lastHand;
  if (!lh) return [];
  const lines = (lh.results ?? [])
    .filter((r) => r.won > 0)
    .slice(0, 9)
    .map((r) => `${mention(r.userId)} won ${money(r.won)}${r.handName ? ` (${r.handName})` : ''}`);
  return lines.length ? [`**Hand #${lh.handNumber}:** ${lines.join('; ')}`] : [];
}

function legalFor(state, userId) {
  const l = legalActions(state, userId);
  return l && l.isTurn ? l : null;
}

function toActUserId(state) {
  const s = state.toAct != null ? state.seats[state.toAct] : null;
  return s ? s.userId : null;
}

function actionRows(state) {
  const uid = toActUserId(state);
  const l = uid ? legalFor(state, uid) : null;
  const canRaise = l ? Boolean(l.canRaise) : false;
  const toCall = l ? l.callAmount : 0;
  const callLabel = toCall > 0 ? `Call ${money(toCall)}` : 'Check';
  return [
    row(
      button(state, 'fold', 'Fold', DANGER),
      button(state, 'call', callLabel, SUCCESS),
      button(state, 'raise', 'Raise', PRIMARY, !canRaise),
      button(state, 'allin', 'All-in', PRIMARY, l ? !l.canAllIn : false),
    ),
    row(
      button(state, 'hand', 'My hand', SECONDARY),
      button(state, 'leave', 'Leave', SECONDARY),
      button(state, 'sitout', 'Sit out / in', SECONDARY),
    ),
  ];
}

function lobbyRows(state) {
  const full = seated(state).length >= state.config.seats;
  const ready = seated(state).filter((s) => !s.sittingOut).length >= 2;
  const second = [button(state, 'sitout', 'Sit out / in', SECONDARY)];
  if (state.config.rebuys) second.unshift(button(state, 'rebuy', 'Rebuy', SECONDARY));
  return [
    row(
      button(state, 'sit', 'Sit', SUCCESS, full),
      button(state, 'leave', 'Leave', SECONDARY),
      button(state, 'start', 'Start hand', PRIMARY, !ready),
      button(state, 'hand', 'My hand', SECONDARY),
    ),
    row(...second),
  ];
}

/** The single public table panel. */
export function tableMessage(state) {
  const header = headerLine(state);

  if (state.phase === 'closed') {
    return {
      embeds: [
        {
          title: '♠️ Poker table closed',
          description: truncate(
            [
              header,
              state.status || 'Thanks for playing! Everyone has been cashed out.',
              ...lastHandLines(state),
            ].join('\n'),
            2000,
          ),
          color: COLOR_GREY,
          fields: seated(state).length ? [seatsField(state, false)] : [],
        },
      ],
      components: [],
    };
  }

  if (state.phase === 'hand') {
    const lines = [header];
    const uid = toActUserId(state);
    if (uid) {
      lines.push(
        `**To act:** ${mention(uid)}${state.turnDeadline ? ` ${ts(state.turnDeadline)}` : ''}`,
      );
    }
    if (state.status) lines.push(state.status);
    const street = STREETS[state.street] ?? state.street ?? '';
    return {
      embeds: [
        {
          title: `♠️ Poker · Hand #${state.handNumber}${street ? ` · ${street}` : ''}`,
          description: truncate(lines.join('\n'), 2000),
          color: COLOR,
          fields: [
            { name: 'Board', value: boardText(state.board), inline: true },
            { name: 'Pot', value: money(potOf(state)), inline: true },
            { name: 'Current bet', value: money(state.currentBet ?? 0), inline: true },
            seatsField(state, true),
          ],
          footer: { text: 'D = dealer, SB/BB = blinds. Press My hand to see your cards.' },
        },
      ],
      components: actionRows(state),
    };
  }

  const waiting =
    state.phase === 'between'
      ? 'Next hand starts soon, or the host can press Start hand.'
      : 'Take a seat to play.';
  return {
    embeds: [
      {
        title: '♠️ Poker table',
        description: truncate(
          [header, state.status || waiting, ...lastHandLines(state)].join('\n'),
          2000,
        ),
        color: COLOR,
        fields: [seatsField(state, false)],
        footer: {
          text: `${seated(state).length}/${state.config.seats} seated. Host: press Start hand with 2+ players.`,
        },
      },
    ],
    components: lobbyRows(state),
  };
}

// ---- Private hand view ------------------------------------------------------

/** Best made hand name from hole cards and a partial (3+) board, or null. */
export function currentHandName(variant, hole, board) {
  if (!board || board.length < 3 || !hole?.length) return null;
  const h = hole.map(parseCard);
  const b = board.map(parseCard);
  let sets;
  if (variant === 'plo') {
    sets = [];
    for (const two of combos(h, 2)) {
      for (const three of combos(b, 3)) sets.push([...two, ...three]);
    }
  } else {
    sets = combos([...h, ...b], 5);
  }
  let top = null;
  for (const five of sets) {
    const r = rank5(five);
    if (!top || compareHands(r, top) > 0) top = r;
  }
  return top ? handName(top) : null;
}

export function handMessage(state, userId) {
  const i = seatIndex(state, userId);
  if (i < 0) {
    return { content: 'You are not seated at this table. Press Sit to join.', flags: EPHEMERAL };
  }
  const s = state.seats[i];
  if (state.phase !== 'hand' || !s.hole || s.hole.length === 0) {
    return {
      content: `No hand in progress. Your stack: **${money(s.stack)}**.`,
      flags: EPHEMERAL,
    };
  }
  const lines = [`Your hand: **${formatCards(s.hole)}**`];
  if (state.board?.length) lines.push(`Board: ${boardText(state.board)}`);
  const made = currentHandName(state.config.variant, s.hole, state.board);
  if (made) lines.push(`You have: ${made}`);
  lines.push(
    `Stack: **${money(s.stack)}**${s.bet > 0 ? ` (bet ${money(s.bet)} this street)` : ''}`,
  );
  if (s.status === 'folded') {
    lines.push('You have folded.');
  } else if (s.status === 'allin') {
    lines.push('You are all-in.');
  } else if (state.toAct === i) {
    const l = legalFor(state, userId);
    if (l) {
      const acts = ['Fold', l.callAmount > 0 ? `Call ${money(l.callAmount)}` : 'Check'];
      if (l.canRaise) acts.push(`Raise (${money(l.minRaiseTo)} to ${money(l.maxRaiseTo)})`);
      acts.push('All-in');
      lines.push(`**Your turn.** Options: ${acts.join(', ')}.`);
    } else {
      lines.push('**Your turn.**');
    }
  } else {
    lines.push('Waiting for your turn.');
  }
  return { content: lines.join('\n'), flags: EPHEMERAL };
}

// ---- Modals -----------------------------------------------------------------

const modal = (custom_id, title, input) => ({
  type: 9,
  data: {
    custom_id,
    title,
    components: [
      {
        type: ACTION_ROW,
        components: [
          { type: 4, style: 1, min_length: 1, max_length: 12, required: true, ...input },
        ],
      },
    ],
  },
});

/** Raise-to modal, or an ephemeral refusal when the viewer cannot raise now. */
export function raiseModal(state, userId) {
  const i = seatIndex(state, userId);
  if (i < 0) {
    return { content: 'You are not seated at this table.', flags: EPHEMERAL };
  }
  if (state.phase !== 'hand' || state.toAct !== i) {
    return { content: "It's not your turn.", flags: EPHEMERAL };
  }
  const l = legalFor(state, userId);
  if (!l || !l.canRaise) {
    return { content: "You can't raise right now. Call, check or go all-in.", flags: EPHEMERAL };
  }
  return modal(`pk_raise_modal|${state.channelId}`, 'Raise', {
    custom_id: 'raise_input',
    label: truncate(`Raise to (${money(l.minRaiseTo)} - ${money(l.maxRaiseTo)})`, 45),
    placeholder: String(l.minRaiseTo),
  });
}

/** Buy-in modal. Returns null when the buy-in is fixed (no input needed). */
export function sitModal(state) {
  const { buyin, buyinMin, buyinMax } = state.config;
  if (buyinMin === buyinMax) return null;
  return modal(`pk_sit_modal|${state.channelId}`, 'Buy in', {
    custom_id: 'buyin_input',
    label: truncate(`Buy-in (${money(buyinMin)} - ${money(buyinMax)})`, 45),
    placeholder: String(buyin),
  });
}

// ---- Follow-ups and results --------------------------------------------------

/** Short "your turn" follow-up that pings only the player to act. */
export function turnPing(state) {
  const uid = toActUserId(state);
  if (!uid) return null;
  return {
    content: `${mention(uid)} it's your turn${state.turnDeadline ? ` ${ts(state.turnDeadline)}` : ''}.`,
    allowed_mentions: { parse: [], users: [uid] },
  };
}

/** Public results of the last hand. Reveals only cards of players who showed. */
export function showdownMessage(state) {
  const lh = state.lastHand;
  if (!lh) return null;
  const lines = (lh.results ?? []).slice(0, 9).map((r) => {
    const parts = [mention(r.userId), r.won > 0 ? `wins ${money(r.won)}` : 'shows'];
    if (lh.showdown && r.cards?.length) parts.push(`with **${formatCards(r.cards)}**`);
    if (lh.showdown && r.handName) parts.push(`(${r.handName})`);
    return parts.join(' ');
  });
  const fields = [];
  if (lh.board?.length) fields.push({ name: 'Board', value: boardText(lh.board) });
  return {
    embeds: [
      {
        title: `🏆 Hand #${lh.handNumber} results`,
        description: truncate(lines.join('\n') || 'No winner.', 4000),
        color: COLOR_GOLD,
        fields,
      },
    ],
    components: [],
    allowed_mentions: { parse: [] },
  };
}

// ---- Rules, leaderboard, bank -------------------------------------------------

export function rulesMessage() {
  const list = [...CATEGORIES]
    .reverse()
    .map((n, i) => `${i + 1}. ${n}`)
    .join('\n');
  return {
    embeds: [
      {
        title: '♠️ Poker rules',
        color: COLOR,
        fields: [
          { name: 'Hand rankings (best first)', value: list },
          {
            name: 'Buttons',
            value: [
              '**Sit** / **Leave**: take or give up a seat (leaving takes effect after the hand).',
              '**Fold**, **Check/Call**, **Raise** (type the total you raise to), **All-in**: act on your turn.',
              '**My hand**: shows your cards only to you.',
              '**Rebuy**: add chips between hands if you are low. **Sit out**: skip hands.',
              'If the timer runs out you check if free, otherwise fold.',
            ].join('\n'),
          },
          {
            name: 'Variants',
            value:
              "Hold'em is no-limit. Omaha is pot-limit and you must use exactly 2 of your 4 cards plus 3 from the board.",
          },
        ],
        footer: { text: 'Play money only: chips have no real value. Play fair and have fun.' },
      },
    ],
    flags: EPHEMERAL,
  };
}

/** Ranked leaderboard. rows: [{ userId, net, biggestPot? }] best first. */
export function leaderboardEmbed(rows) {
  const medals = ['🥇', '🥈', '🥉'];
  const lines = (rows ?? []).slice(0, 10).map((r, i) => {
    const sign = r.net > 0 ? '+' : '';
    const pot = r.biggestPot ? ` · biggest pot ${money(r.biggestPot)}` : '';
    return `${medals[i] ?? `${i + 1}.`} ${mention(r.userId)} ${sign}${money(r.net)}${pot}`;
  });
  return {
    embeds: [
      {
        title: '🏆 Poker leaderboard',
        description: lines.length
          ? truncate(lines.join('\n'), 4000)
          : 'No ranked results yet. Start a ranked table with `/poker start mode:ranked`.',
        color: COLOR_GOLD,
        footer: { text: 'Ranked net profit (cash-outs minus buy-ins).' },
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

/** Ephemeral bankroll summary from a bankroll record. */
export function bankMessage(record) {
  const stats = record?.stats ?? {};
  const net = stats.net ?? 0;
  return {
    embeds: [
      {
        title: '💰 Your poker bankroll',
        color: COLOR,
        fields: [
          { name: 'Balance', value: money(record?.balance ?? 0), inline: true },
          { name: 'Net profit', value: `${net > 0 ? '+' : ''}${money(net)}`, inline: true },
          { name: 'Hands won', value: String(stats.handsWon ?? 0), inline: true },
          { name: 'Biggest pot', value: money(stats.biggestPot ?? 0), inline: true },
        ],
        footer: { text: 'Play money only. /poker daily tops you up when you are low.' },
      },
    ],
    flags: EPHEMERAL,
  };
}
