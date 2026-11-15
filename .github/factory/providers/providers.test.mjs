import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInvocation, validateInvocation } from './contract.mjs';
import { createClaudeAdapter } from './claude.mjs';
import { createCodexAdapter } from './codex.mjs';
import { createProviderRegistry } from './index.mjs';
import { codexCommand, restrictedEnvironment } from '../runner/codex-cli.mjs';

const invocation = (provider = 'claude', role = 'worker') => makeInvocation({
  goal_id: 'G1', goal_version: 'goal-sha', role, provider,
  repository: 'owner/repo', base_sha: 'commit-sha', task_id: role === 'worker' ? 'G1-T1' : null,
  issue: 3, pull_request: role === 'reviewer' ? 7 : null, attempt: 1,
  timeout_ms: 5000, retry_budget: 2, immutable_context: { requirement: 'build it' },
  output_schema: { type: 'object' },
});

test('provider contract is content-addressed and detects mutation', () => {
  const value = invocation();
  assert.deepEqual(validateInvocation(value), []);
  assert.match(value.id, /^inv_/);
  assert.match(validateInvocation({ ...value, goal_version: 'changed' }).join(';'), /id does not match/);
});

test('Claude adapter preserves the existing routine endpoint and maps quota safely', async () => {
  let request;
  const adapter = createClaudeAdapter({
    env: { FACTORY_ROUTINE_ID: 'routine-1', FACTORY_FIRE_TOKEN: 'secret' },
    fetchImpl: async (url, options) => { request = { url, options }; return { status: 429, json: async () => ({}) }; },
  });
  const result = await adapter.invoke(invocation('claude'), 'worker');
  assert.equal(result.status, 'quota-exhausted');
  assert.match(request.url, /routines\/routine-1\/fire$/);
  assert.doesNotMatch(request.options.body, /secret/);
});

test('Codex adapter requires an explicit trusted runner and never falls back', async () => {
  const missing = createCodexAdapter({ env: {} });
  assert.equal((await missing.invoke(invocation('codex'))).status, 'unavailable');
  let called = 0;
  const configured = createCodexAdapter({
    env: { FACTORY_CODEX_RUNNER_URL: 'http://127.0.0.1:8787/invoke', FACTORY_CODEX_RUNNER_TOKEN: 'runner-secret' },
    fetchImpl: async () => { called++; return { status: 200, ok: true, json: async () => ({ status: 'completed', invocation_id: invocation('codex').id, run_id: 'run-1' }) }; },
  });
  assert.equal((await configured.invoke(invocation('codex'))).status, 'completed');
  assert.equal(called, 1);
  const registry = createProviderRegistry({ claude: { env: {} }, codex: { env: {} } });
  assert.equal(registry.availability('codex').available, false);
  assert.throws(() => registry.invoke('unknown', invocation('codex')), /Unknown provider/);
});

test('Codex runner gives reviewers a read-only sandbox and workers workspace-write', () => {
  const review = codexCommand(invocation('codex', 'reviewer'), { workspace: '/tmp/repo', schemaPath: '/tmp/schema.json' });
  const worker = codexCommand(invocation('codex', 'worker'), { workspace: '/tmp/repo', schemaPath: '/tmp/schema.json' });
  assert.equal(review.args[review.args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(worker.args[worker.args.indexOf('--sandbox') + 1], 'workspace-write');
  assert.ok(review.args.includes('--ephemeral'));
  assert.ok(review.args.includes('--ignore-user-config'));
  const env = restrictedEnvironment({ PATH: '/bin', OPENAI_API_KEY: 'paid-key', GITHUB_TOKEN: 'shared', FACTORY_REVIEWER_GITHUB_TOKEN: 'review-only', FACTORY_WORKER_GITHUB_TOKEN: 'worker-only' }, 'reviewer');
  assert.deepEqual(env, { PATH: '/bin', GITHUB_TOKEN: 'review-only' });
});
