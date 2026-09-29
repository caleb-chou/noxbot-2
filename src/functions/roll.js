const DICE = /^(\d*)d(\d+)([+-]\d+)?$/i;
const MAX_DICE = 100;
const MAX_SIDES = 1000;

/** Roll "NdM+K" (N and K optional). Throws a user-facing message on bad input. */
export function rollDice(spec = '1d6') {
  const match = DICE.exec(spec.replace(/\s+/g, ''));
  if (!match) {
    throw new Error('Use dice like `d20`, `2d6` or `3d8+2`.');
  }
  const count = Number(match[1] || 1);
  const sides = Number(match[2]);
  const modifier = Number(match[3] ?? 0);

  if (count < 1 || count > MAX_DICE || sides < 2 || sides > MAX_SIDES) {
    throw new Error(`Roll 1-${MAX_DICE} dice with 2-${MAX_SIDES} sides.`);
  }

  const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
  const total = rolls.reduce((a, b) => a + b, 0) + modifier;
  return { rolls, modifier, total };
}
