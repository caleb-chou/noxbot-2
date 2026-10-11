import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
  tableMessage,
  handMessage,
  raiseModal,
  sitModal,
  turnPing,
  showdownMessage,
  rulesMessage,
  leaderboardEmbed,
  bankMessage,
  money,
  truncate,
} from '../src/functions/poker/messages.js';
import { formatCard, newDeck } from '../src/functions/poker/cards.js';
import { parseTableConfig } from '../src/functions/poker/config.js';

const CH = '111222333444555666';
const uid = (n) => `9000000000000000${String(n).padStart(2, '0')}`;

const config = (opts = {}) => parseTableConfig(opts).config;

function seat(n, extra = {}) {
  return {
    userId: uid(n),
    stack: 500,
    bet: 0,
    committed: 0,
    status: 'active',
    sittingOut: false,
    hole: [],
    hasActed: false,
    timeouts: 0,
    rebuys: 0,
    buyIns: 1,
    leaving: false,
    ...extra,
  };
}

const HOLES = [
  ['As', 'Ks'],
  ['Qh', 'Jh'],
  ['9d', '8d'],
  ['7c', '6c'],
  ['2s', '3h'],
  ['4d', '5c'],
];

function handState(opts = {}) {
  const cfg = config({ seats: 6, ...opts });
  const seats = Array(cfg.seats).fill(null);
  for (let i = 0; i < 6; i++) {
    seats[i] = seat(i + 1, { hole: HOLES[i], stack: 480, bet: i === 1 ? 2 : i === 2 ? 4 : 0, committed: i === 1 ? 2 : i === 2 ? 4 : 0 });
  }
  seats[4].status = 'folded';
  return {
    config: cfg,
    phase: 'hand',
    hostId: uid(1),
    channelId: CH,
    guildId: 'g1',
    messageId: 'm1',
    seats,
    button: 0,
    blinds: { small: 1, big: 2 },
    handNumber: 3,
    street: 'flop',
    board: ['Ah', 'Kd', '7s'],
    deck: ['Td', 'Tc', 'Th', 'Ts', '2d', '2c'],
    currentBet: 4,
    minRaise: 2,
    toAct: 3,
    turnDeadline: 1_800_000_000_000,
    status: `${'<@x>'} called`,
    lastHand: null,
    updatedAt: 0,
  };
}

const all = (m) => JSON.stringify(m);

describe('money', () => {
  it('formats dollars with separators', () => {
    expect(money(500)).to.equal('$500');
    expect(money(1234567)).to.equal('$1,234,567');
    expect(money(0)).to.equal('$0');
    expect(money(-1500)).to.equal('-$1,500');
  });
  it('truncate respects the limit', () => {
    expect(truncate('abcdef', 4)).to.equal('abc…');
    expect(truncate('abc', 4)).to.equal('abc');
  });
});

describe('tableMessage', () => {
  it('renders the board in emoji with street separators', () => {
    const s = handState();
    s.board = ['Ah', 'Kd', '7s', 'Tc', '2h'];
    const text = all(tableMessage(s));
    expect(text).to.include(`${formatCard('Ah')} ${formatCard('Kd')} ${formatCard('7s')} | ${formatCard('Tc')} | ${formatCard('2h')}`);
    expect(text).to.include('T♣️');
  });

  it('shows pot, stacks, markers, tags, turn mention and countdown', () => {
    const s = handState();
    s.seats[3].status = 'allin';
    s.seats[5].sittingOut = true;
    const msg = tableMessage(s);
    const text = all(msg);
    expect(text).to.include('$6'); // pot 2 + 4
    expect(text).to.include('$480');
    expect(text).to.include('**D**');
    expect(text).to.include('SB');
    expect(text).to.include('BB');
    expect(text).to.include('folded');
    expect(text).to.include('ALL-IN');
    expect(text).to.include('sitting out');
    expect(text).to.include(`<@${uid(4)}>`);
    expect(text).to.include('<t:1800000000:R>');
    expect(text).to.include('Current bet');
  });

  it('lobby shows Sit buttons and empty seats', () => {
    const cfg = config({ seats: 4 });
    const s = {
      config: cfg, phase: 'lobby', hostId: uid(1), channelId: CH, seats: [seat(1), null, null, null],
      button: null, handNumber: 0, board: [], lastHand: null,
    };
    const msg = tableMessage(s);
    expect(all(msg)).to.include('empty');
    const ids = msg.components.flatMap((r) => r.components.map((c) => c.custom_id));
    expect(ids).to.include(`pk_sit|${CH}`);
    expect(ids).to.include(`pk_start|${CH}`);
    const start = msg.components[0].components.find((c) => c.custom_id.startsWith('pk_start'));
    expect(start.disabled).to.equal(true); // one player only
  });

  it('closed table has no buttons', () => {
    const s = handState();
    s.phase = 'closed';
    s.status = 'Table closed.';
    const msg = tableMessage(s);
    expect(msg.components).to.deep.equal([]);
    expect(all(msg)).to.include('Table closed.');
  });

  it('hand buttons: Fold/Check|Call/Raise/All-in in one row, Call shows amount', () => {
    const s = handState();
    const msg = tableMessage(s);
    const labels = msg.components[0].components.map((c) => c.label);
    expect(labels[0]).to.equal('Fold');
    expect(labels[1]).to.equal('Call $4');
    expect(labels[2]).to.equal('Raise');
    expect(labels[3]).to.equal('All-in');
    expect(msg.components[0].components[2].disabled).to.not.equal(true);
  });

  it('shows Check when nothing to call', () => {
    const s = handState();
    s.seats[3].bet = 4;
    s.seats[3].committed = 4;
    const msg = tableMessage(s);
    expect(msg.components[0].components[1].label).to.equal('Check');
  });

  it('disables Raise when the player to act cannot raise', () => {
    const s = handState();
    // Stack no bigger than the call: can only call or shove.
    s.seats[3].stack = 3;
    const msg = tableMessage(s);
    expect(msg.components[0].components[2].disabled).to.equal(true);
  });

  it('every custom_id follows pk_<action>|<channelId> within 100 chars', () => {
    const msgs = [tableMessage(handState()), tableMessage({ ...handState(), phase: 'between' })];
    for (const m of msgs) {
      for (const r of m.components) {
        expect(r.components.length).to.be.at.most(5);
        for (const c of r.components) {
          expect(c.custom_id).to.match(/^pk_[a-z]+\|\d+$/);
          expect(c.custom_id.length).to.be.at.most(100);
        }
      }
      expect(m.components.length).to.be.at.most(5);
    }
  });

  it('9 seats with huge stacks fits Discord limits', () => {
    const cfg = config({ seats: 9 });
    const long = '1'.repeat(19);
    const seats = Array.from({ length: 9 }, (_, i) =>
      seat(i, { userId: long, stack: 999_999_999, bet: 999_999_999, committed: 999_999_999, status: i % 2 ? 'allin' : 'active', sittingOut: i === 3 }),
    );
    const s = { ...handState(), config: cfg, seats, board: ['Ah', 'Kd', '7s', 'Tc', '2h'], toAct: 2 };
    const msg = tableMessage(s);
    const embed = msg.embeds[0];
    let total = (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0);
    expect(embed.fields.length).to.be.at.most(25);
    for (const f of embed.fields) {
      expect(f.value.length).to.be.at.most(1024);
      expect(f.name.length).to.be.at.most(256);
      total += f.name.length + f.value.length;
    }
    expect(embed.description.length).to.be.at.most(4096);
    expect(total).to.be.at.most(6000);
  });
});

describe('handMessage', () => {
  it('shows the viewer only their own hole cards, ephemeral', () => {
    const s = handState();
    const msg = handMessage(s, uid(4));
    expect(msg.flags).to.equal(64);
    expect(msg.content).to.include('7♣️');
    expect(msg.content).to.include('6♣️');
    expect(msg.content).to.not.include('A♠️');
    expect(msg.content).to.not.include(formatCard('Qh'));
  });

  it('includes stack, best hand name with 3+ board cards, legal actions on turn', () => {
    const s = handState();
    const msg = handMessage(s, uid(1)); // As Ks + Ah Kd 7s
    expect(msg.content).to.include('Two pair');
    expect(msg.content).to.include('$480');
    const turn = handMessage(s, uid(4));
    expect(turn.content).to.include('Your turn');
    expect(turn.content).to.include('Call $4');
    expect(turn.content).to.include('Fold');
  });

  it('omits hand name before the flop', () => {
    const s = handState();
    s.board = [];
    s.street = 'preflop';
    expect(handMessage(s, uid(1)).content).to.not.include('You have:');
  });

  it('plo hand name uses exactly two hole cards (no 3-hole royal)', () => {
    const s = handState({ variant: 'plo' });
    s.seats[0].hole = ['As', 'Ks', 'Qs', '2c'];
    s.board = ['Js', 'Ts', '3s'];
    expect(handMessage(s, uid(1)).content).to.include('Flush, Ace high');
  });

  it('gives a friendly refusal to non-seated viewers', () => {
    const msg = handMessage(handState(), 'stranger');
    expect(msg.flags).to.equal(64);
    expect(msg.content).to.match(/not seated/i);
    expect(all(msg)).to.not.include('A♠️');
  });
});

describe('modals', () => {
  it('raiseModal is a type 9 modal with range label and channel custom_id', () => {
    const m = raiseModal(handState(), uid(4));
    expect(m.type).to.equal(9);
    expect(m.data.custom_id).to.equal(`pk_raise_modal|${CH}`);
    const input = m.data.components[0].components[0];
    expect(input.type).to.equal(4);
    expect(input.label).to.match(/\$\d+ - \$[\d,]+/);
    expect(input.label.length).to.be.at.most(45);
    expect(m.data.title.length).to.be.at.most(45);
  });

  it('raiseModal refuses when not your turn, not seated, or cannot raise', () => {
    const s = handState();
    expect(raiseModal(s, uid(1)).flags).to.equal(64);
    expect(raiseModal(s, 'nobody').flags).to.equal(64);
    s.seats[3].stack = 3;
    const r = raiseModal(s, uid(4));
    expect(r.flags).to.equal(64);
    expect(r.type).to.equal(undefined);
  });

  it('sitModal shows the range with default placeholder; null when fixed', () => {
    const ranged = { ...handState(), config: config({ buyin: 500, buyin_min: 100, buyin_max: 1000 }), channelId: CH };
    const m = sitModal(ranged);
    expect(m.type).to.equal(9);
    expect(m.data.custom_id).to.equal(`pk_sit_modal|${CH}`);
    const input = m.data.components[0].components[0];
    expect(input.label).to.include('$100');
    expect(input.label).to.include('$1,000');
    expect(input.placeholder).to.equal('500');
    expect(sitModal({ ...handState(), config: config({}) })).to.equal(null);
  });
});

describe('turnPing', () => {
  it('mentions only the player to act', () => {
    const p = turnPing(handState());
    expect(p.content).to.include(`<@${uid(4)}>`);
    expect(p.content).to.include('<t:1800000000:R>');
    expect(p.allowed_mentions).to.deep.equal({ parse: [], users: [uid(4)] });
  });
  it('is null when nobody is to act', () => {
    expect(turnPing({ ...handState(), toAct: null })).to.equal(null);
  });
});

describe('showdownMessage', () => {
  const lastHand = (extra = {}) => ({
    handNumber: 3,
    board: ['Ah', 'Kd', '7s', 'Tc', '2h'],
    showdown: true,
    results: [
      { userId: uid(1), won: 300, handName: 'Two pair, Aces and Kings', cards: ['As', 'Ks'] },
      { userId: uid(2), won: 0, handName: 'Pair of Queens', cards: ['Qh', 'Jh'] },
    ],
    ...extra,
  });

  it('reveals cards of players who showed, with amounts and hand names', () => {
    const msg = showdownMessage({ ...handState(), lastHand: lastHand() });
    const text = all(msg);
    expect(text).to.include('A♠️ K♠️');
    expect(text).to.include('$300');
    expect(text).to.include('Two pair, Aces and Kings');
    expect(text).to.include('Q♥️ J♥️');
    expect(msg.allowed_mentions).to.deep.equal({ parse: [] });
  });

  it('never reveals cards for players without cards in results (uncontested/folded)', () => {
    const lh = lastHand({
      showdown: false,
      results: [{ userId: uid(1), won: 6, handName: null, cards: undefined }],
    });
    const text = all(showdownMessage({ ...handState(), lastHand: lh }));
    for (const h of HOLES) for (const c of h) expect(text).to.not.include(formatCard(c));
  });

  it('does not print cards when showdown is false even if provided', () => {
    const lh = lastHand({ showdown: false });
    const text = all(showdownMessage({ ...handState(), lastHand: lh }));
    expect(text).to.not.include('A♠️');
    expect(text).to.not.include('Q♥️');
  });

  it('returns null without a last hand', () => {
    expect(showdownMessage(handState())).to.equal(null);
  });
});

describe('privacy of public output mid-hand', () => {
  it('no public builder leaks hole cards or the deck', () => {
    const s = handState();
    s.lastHand = { handNumber: 2, board: [], showdown: false, results: [{ userId: uid(1), won: 6 }] };
    const outputs = [
      tableMessage(s),
      tableMessage({ ...s, phase: 'between' }),
      tableMessage({ ...s, phase: 'closed' }),
      turnPing(s),
      showdownMessage(s),
      raiseModal(s, uid(1)), // refusal, not your turn
      raiseModal(s, 'stranger'),
      handMessage(s, 'stranger'),
      rulesMessage(),
      leaderboardEmbed([{ userId: uid(1), net: 5 }]),
      bankMessage({ balance: 5000, stats: {} }),
    ].map(all);
    const secrets = [...s.seats.flatMap((x) => x.hole), ...s.deck];
    // Board cards are public; only check secrets that are not on the board.
    const hidden = secrets.filter((c) => !s.board.includes(c));
    for (const out of outputs) {
      for (const c of hidden) {
        expect(out, `leaked ${c}`).to.not.include(formatCard(c));
        expect(out, `leaked raw ${c}`).to.not.match(new RegExp(`"[^"]*\\b${c}\\b`));
      }
      expect(out).to.not.include('"deck"');
      expect(out).to.not.include('"hole"');
    }
  });

  it('the full deck never appears in any public output', () => {
    const s = handState();
    const out = all(tableMessage(s)) + all(turnPing(s));
    const onBoard = new Set(s.board);
    const seen = newDeck().filter((c) => !onBoard.has(c) && out.includes(formatCard(c)));
    expect(seen).to.deep.equal([]);
  });
});

describe('rules, leaderboard, bank', () => {
  it('rules are ephemeral with rankings and the honor note', () => {
    const m = rulesMessage();
    expect(m.flags).to.equal(64);
    const t = all(m);
    expect(t).to.include('Straight flush');
    expect(t).to.include('Play money');
  });

  it('leaderboard ranks net profit with mentions', () => {
    const m = leaderboardEmbed([
      { userId: uid(1), net: 1500, biggestPot: 900 },
      { userId: uid(2), net: -200 },
    ]);
    const d = m.embeds[0].description;
    expect(d.indexOf(uid(1))).to.be.lessThan(d.indexOf(uid(2)));
    expect(d).to.include('+$1,500');
    expect(d).to.include('-$200');
    expect(leaderboardEmbed([]).embeds[0].description).to.match(/No ranked/);
  });

  it('bank message shows balance and stats', () => {
    const m = bankMessage({ balance: 12345, stats: { net: 250, handsWon: 7, biggestPot: 800 } });
    const t = all(m);
    expect(m.flags).to.equal(64);
    expect(t).to.include('$12,345');
    expect(t).to.include('+$250');
    expect(t).to.include('$800');
  });
});
