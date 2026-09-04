import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SeededRandom } from './seeded-random';

describe('SeededRandom', () => {
  it('相同种子产生相同序列且结果位于 [0, 1)', () => {
    const first = new SeededRandom(42);
    const second = new SeededRandom(42);
    const firstValues = Array.from({ length: 8 }, () => first.next());
    const secondValues = Array.from({ length: 8 }, () => second.next());

    assert.deepEqual(firstValues, secondValues);
    assert.equal(
      firstValues.every((value) => value >= 0 && value < 1),
      true,
    );
  });
});
