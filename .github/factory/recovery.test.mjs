import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileAttempt, reconcileMerge, reconcileReview, reconcileTaskCreation } from './recovery.mjs';
import { decide } from './lib.mjs';

test('task creation resumes safely after crashes before and after GitHub side effects', () => {
  const pending = { status: 'pending', started_at: 1000 };
  assert.equal(reconcileTaskCreation(pending, [], 2000).action, 'wait');
  assert.deepEqual(reconcileTaskCreation(pending, [{ number: 14 }], 2000), { action: 'complete', issue: 14 });
  assert.equal(reconcileTaskCreation(pending, [], 1000 + 11 * 60_000).action, 'retry');
  assert.equal(reconcileTaskCreation(pending, [{ number: 14 }, { number: 15 }], 2000).action, 'needs-human');
});

test('a PR created before dispatcher state was recorded is adopted by branch attempt', () => {
  assert.equal(reconcileAttempt(2, [{ number: 9, attempt: 2, state: 'open' }]).pullRequest.number, 9);
  assert.equal(reconcileAttempt(2, [{ number: 9, attempt: 2, state: 'closed', merged_at: 'now' }]).pullRequest.number, 9);
  assert.equal(reconcileAttempt(2, [{ number: 8, attempt: 1, state: 'open' }]).action, 'wait');
  assert.equal(reconcileAttempt(2, [{ number: 9, attempt: 2, state: 'open' }, { number: 10, attempt: 2, state: 'open' }]).action, 'needs-human');
});

test('unknown merge outcomes retry only when GitHub proves the merge did not happen', () => {
  assert.equal(reconcileMerge({ state: 'open', merged_at: null, head: { sha: 'h1' } }, 'h1').action, 'retry');
  assert.equal(reconcileMerge({ state: 'closed', merged_at: 'now', head: { sha: 'h1' } }, 'h1').action, 'complete');
  assert.equal(reconcileMerge({ state: 'open', merged_at: null, head: { sha: 'h2' } }, 'h1').action, 'needs-human');
  assert.equal(reconcileMerge({ state: 'closed', merged_at: null, head: { sha: 'h1' } }, 'h1').action, 'needs-human');
});

test('partial reviews resume only for the leased exact SHA and timestamp', () => {
  const lease = { reviewSha: 'h1', reviewAt: 1000 };
  const pr = { state: 'open', headSha: 'h1' };
  assert.equal(reconcileReview(lease, pr, null).action, 'wait');
  assert.equal(reconcileReview(lease, pr, { sha: 'h1', at: 1100, verdict: 'approve' }).action, 'complete');
  assert.equal(reconcileReview(lease, { ...pr, headSha: 'h2' }, null).action, 'retry-worker');
  assert.equal(reconcileReview(lease, pr, { invalid: 'unauthorized' }).action, 'needs-human');
});

test('dispatcher prioritizes durable operation recovery after restart', () => {
  const state = { now: 1, goalsSha: 'g', goalIds: ['G1'], plan: null, issues: [],
    status: { canonical: { provider: { active: 'claude' } } },
    operationRecoveries: [{ id: 'create:G1-T1', type: 'create-task', issue: 14 }], mainCi: 'green' };
  assert.deepEqual(decide(state), [{ type: 'recover-operations', operations: state.operationRecoveries }]);
});
