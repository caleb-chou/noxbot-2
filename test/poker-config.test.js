import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
  DEFAULT_LADDER_TEXT,
  parseLadder,
  parseTableConfig,
  ladderLevel,
  currentBlinds,
} from '../src/functions/poker/config.js';
import { POKER_COMMAND } from '../src/commands.js';

describe('poker command definition', () => {
  it('has the expected subcommands and optional-only start options', () => {
    expect(POKER_COMMAND.contexts).to.deep.equal([0, 2]);
    expect(POKER_COMMAND.integration_types).to.deep.equal([0, 1]);
    expect(POKER_COMMAND.options.map((o) => o.name)).to.deep.equal([
      'start', 'end', 'bank', 'daily', 'leaderboard', 'rules',
    ]);
    const start = POKER_COMMAND.options[0];
    expect(start.options.some((o) => o.required)).to.equal(false);
    for (const o of start.options) expect(o.description.length).to.be.at.most(100);
  });
});

describe('parseLadder', () => {
  it('parses the default ladder', () => {
    const l = parseLadder(DEFAULT_LADDER_TEXT);
    expect(l).to.have.length(8);
    expect(l[0]).to.deep.equal({ small: 1, big: 2 });
    expect(l[7]).to.deep.equal({ small: 50, big: 100 });
  });

  it('tolerates spaces', () => {
    expect(parseLadder(' 1 / 2 , 2/4 ,  5 /10 ')).to.deep.equal([
      { small: 1, big: 2 }, { small: 2, big: 4 }, { small: 5, big: 10 },
    ]);
  });

  it('accepts a single fixed level', () => {
    expect(parseLadder('1/2')).to.deep.equal([{ small: 1, big: 2 }]);
  });

  it('rejects junk, decimals, negatives and empty entries', () => {
    for (const bad of ['', '   ', 'abc', '1/2,', ',1/2', '1/2,,2/4', '1.5/3', '-1/2', '1/2/3', '1-2', '1/', '/2']) {
      expect(() => parseLadder(bad), bad).to.throw(Error);
    }
  });

  it('rejects non-string input', () => {
    expect(() => parseLadder(undefined)).to.throw();
    expect(() => parseLadder(12)).to.throw();
  });

  it('rejects small >= big and zero small blinds', () => {
    expect(() => parseLadder('2/2')).to.throw(/less than/);
    expect(() => parseLadder('3/2')).to.throw(/less than/);
    expect(() => parseLadder('0/2')).to.throw(/at least 1/);
  });

  it('requires strictly increasing big blinds', () => {
    expect(() => parseLadder('1/2,2/4,3/4')).to.throw(/higher/);
    expect(() => parseLadder('1/2,1/2')).to.throw(/higher/);
    expect(() => parseLadder('2/4,1/2')).to.throw(/higher/);
  });

  it('allows up to 12 levels and rejects 13', () => {
    const mk = (n) => Array.from({ length: n }, (_, i) => `${i + 1}/${i + 2}`).join(',');
    expect(parseLadder(mk(12))).to.have.length(12);
    expect(() => parseLadder(mk(13))).to.throw(/at most 12/);
  });
});

describe('parseTableConfig defaults', () => {
  it('applies every default for casual', () => {
    const { config, error } = parseTableConfig({});
    expect(error).to.equal(undefined);
    expect(config).to.include({
      variant: 'holdem', mode: 'casual', seats: 6, buyin: 500, buyinMin: 500,
      buyinMax: 500, rebuys: true, maxRebuys: null, escalate: false,
      escalateEvery: 10, timer: 60, ping: true,
    });
    expect(config.ladder).to.deep.equal(parseLadder(DEFAULT_LADDER_TEXT));
  });

  it('works with undefined options', () => {
    expect(parseTableConfig(undefined).config.seats).to.equal(6);
  });

  it('defaults ranked max rebuys to 3 but respects an override', () => {
    expect(parseTableConfig({ mode: 'ranked' }).config.maxRebuys).to.equal(3);
    expect(parseTableConfig({ mode: 'ranked', max_rebuys: 0 }).config.maxRebuys).to.equal(0);
    expect(parseTableConfig({ max_rebuys: 5 }).config.maxRebuys).to.equal(5);
  });

  it('derives buy-in range from buyin and honours explicit values', () => {
    const { config } = parseTableConfig({ buyin: 1000 });
    expect([config.buyinMin, config.buyinMax]).to.deep.equal([1000, 1000]);
    const r = parseTableConfig({ buyin: 500, buyin_min: 200, buyin_max: 2000 }).config;
    expect([r.buyinMin, r.buyin, r.buyinMax]).to.deep.equal([200, 500, 2000]);
  });

  it('passes through explicit options', () => {
    const { config } = parseTableConfig({
      variant: 'plo', seats: 9, rebuys: false, escalate: true, escalate_every: 3,
      timer: 15, ping: false, blinds: '5/10',
    });
    expect(config).to.include({
      variant: 'plo', seats: 9, rebuys: false, escalate: true, escalateEvery: 3,
      timer: 15, ping: false,
    });
    expect(config.ladder).to.deep.equal([{ small: 5, big: 10 }]);
  });
});

describe('parseTableConfig validation', () => {
  const err = (o) => parseTableConfig(o).error;

  it('rejects bad enums', () => {
    expect(err({ variant: 'stud' })).to.match(/Variant/);
    expect(err({ mode: 'x' })).to.match(/Mode/);
  });

  it('rejects bad seats', () => {
    for (const seats of [1, 10, 2.5]) expect(err({ seats }), String(seats)).to.match(/Seats/);
    expect(err({ seats: 2 })).to.equal(undefined);
    expect(err({ seats: 9 })).to.equal(undefined);
  });

  it('rejects a bad ladder', () => {
    expect(err({ blinds: 'nope' })).to.match(/not a blind level/);
    expect(err({ blinds: '2/1' })).to.match(/less than/);
  });

  it('rejects bad buy-ins', () => {
    expect(err({ buyin: 0 })).to.match(/Buy-in/);
    expect(err({ buyin: 1.5 })).to.match(/Buy-in/);
    expect(err({ buyin_min: 1.5 })).to.match(/whole/);
    expect(err({ buyin_min: 1 })).to.match(/one big blind/);
    expect(err({ buyin: 100, buyin_min: 200, buyin_max: 300 })).to.match(/buyin_min/);
    expect(err({ buyin: 100, buyin_max: 50 })).to.match(/buyin_max/);
    // min must cover the first big blind of the chosen ladder
    expect(err({ buyin: 100, blinds: '200/400' })).to.match(/one big blind/);
    expect(err({ buyin: 2 })).to.equal(undefined);
  });

  it('rejects bad max_rebuys, escalate_every and timer', () => {
    expect(err({ max_rebuys: -1 })).to.match(/max_rebuys/);
    expect(err({ escalate_every: 0 })).to.match(/escalate_every/);
    expect(err({ timer: 14 })).to.match(/Timer/);
    expect(err({ timer: 301 })).to.match(/Timer/);
    expect(err({ timer: 300 })).to.equal(undefined);
  });
});

describe('ladderLevel', () => {
  const ladder = parseLadder('1/2,2/4,3/6');

  it('stays at the first level when escalation is off', () => {
    const c = { escalate: false, escalateEvery: 10, ladder };
    expect(ladderLevel(c, 0)).to.equal(0);
    expect(ladderLevel(c, 500)).to.equal(0);
    expect(currentBlinds(c, 500)).to.deep.equal({ small: 1, big: 2 });
  });

  it('steps every N hands and caps at the last level', () => {
    const c = { escalate: true, escalateEvery: 10, ladder };
    expect(ladderLevel(c, 0)).to.equal(0);
    expect(ladderLevel(c, 9)).to.equal(0);
    expect(ladderLevel(c, 10)).to.equal(1);
    expect(ladderLevel(c, 19)).to.equal(1);
    expect(ladderLevel(c, 20)).to.equal(2);
    expect(ladderLevel(c, 1000)).to.equal(2);
    expect(currentBlinds(c, 25)).to.deep.equal({ small: 3, big: 6 });
  });

  it('handles odd hand counts safely', () => {
    const c = { escalate: true, escalateEvery: 1, ladder };
    expect(ladderLevel(c, -3)).to.equal(0);
    expect(ladderLevel(c, undefined)).to.equal(0);
  });

  it('caps buy-ins and blinds so chip arithmetic stays exact', () => {
    expect(parseTableConfig({ buyin: 9_000_000_000_000 }).error).to.match(/at most/);
    expect(parseTableConfig({ buyin: 100, buyin_max: 2e9 }).error).to.match(/at most/);
    expect(parseTableConfig({ buyin: 1e9 }).config.buyin).to.equal(1e9);
    expect(parseTableConfig({ blinds: '1/2000000000', buyin: 1e9 }).error).to.match(/at most/);
  });
});
