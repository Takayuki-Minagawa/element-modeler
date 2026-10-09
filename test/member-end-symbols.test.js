import test from 'node:test';
import assert from 'node:assert/strict';
import { beamStrongAxisEndCondition } from '../js/view-semantics.js';

const springEnd = { condition: 'spring', springSymbol: 'K1' };

test('beam end symbols retain direct pin/rigid conditions and the legacy pin default', () => {
  assert.equal(beamStrongAxisEndCondition({ condition: 'pin' }, { krY: 'rigid' }), 'pin');
  assert.equal(beamStrongAxisEndCondition({ condition: 'rigid' }, { krY: 'pin' }), 'rigid');
  for (const end of [undefined, null, {}]) {
    assert.equal(beamStrongAxisEndCondition(end), 'pin');
  }
});

test('beam spring symbols follow strong-axis krY despite opposite weak-axis and translation values', () => {
  const cases = [
    [{ kr: 2e8, krY: 'pin', krZ: 'rigid', kt: 'rigid' }, 'pin'],
    [{ kr: 'pin', krY: 'rigid', krZ: 'pin', kt: 'pin' }, 'rigid'],
    [{ kr: 'rigid', krY: 2e8, krZ: 'pin', kt: 'pin' }, 'spring'],
    [{ kr: 'pin', krY: '2e8', krZ: 'rigid', kt: 'rigid' }, 'spring'],
  ];
  for (const [spring, expected] of cases) {
    assert.equal(beamStrongAxisEndCondition(springEnd, spring), expected);
  }
});

test('beam spring symbols fall back from unspecified krY to the common rotational stiffness', () => {
  for (const krY of [undefined, null, '']) {
    for (const [kr, expected] of [['pin', 'pin'], ['rigid', 'rigid'], [2e8, 'spring']]) {
      assert.equal(beamStrongAxisEndCondition(springEnd, { kr, krY, krZ: 'rigid' }), expected);
    }
  }
});

test('undefined spring definitions or rotational stiffness retain the spring symbol', () => {
  for (const spring of [undefined, null, {}, { kr: null }, { krY: null, krZ: 'pin', kt: 'rigid' }]) {
    assert.equal(beamStrongAxisEndCondition(springEnd, spring), 'spring');
  }
});
