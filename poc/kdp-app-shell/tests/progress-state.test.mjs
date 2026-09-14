import test from 'node:test';
import assert from 'node:assert/strict';
import { progressVisual } from '../src/progress/progressVisual.js';

test('authoritative progress status selects its icon independently of current page', () => {
  assert.deepEqual(progressVisual('complete'), { text: 'Complete', icon: 'check' });
  assert.deepEqual(progressVisual('in_progress'), { text: 'In Progress...', icon: 'info' });
  assert.deepEqual(progressVisual('locked'), { text: 'Not Started...', icon: 'lock' });
});
