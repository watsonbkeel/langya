import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ClientTickTracker } from './client-tick-tracker';

describe('ClientTickTracker', () => {
  it('只接受严格单调递增的 clientTick', () => {
    const tracker = new ClientTickTracker();

    assert.equal(tracker.accept(0), true);
    assert.equal(tracker.accept(1), true);
    assert.equal(tracker.accept(1), false);
    assert.equal(tracker.accept(0), false);
    assert.equal(tracker.accept(2), true);
  });
});
