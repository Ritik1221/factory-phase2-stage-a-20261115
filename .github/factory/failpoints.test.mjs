import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeFailpoint, hitFailpoint, STAGE_A_FAILPOINTS } from './failpoints.mjs';

const valid = (fault = 'after-journal-append') => ({
  FACTORY_FAULT_POINT: fault,
  FACTORY_INTEGRATION_TEST: 'true',
  FACTORY_INTEGRATION_REPOSITORY: 'owner/factory-phase2-stage-a-20261115',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REPOSITORY: 'owner/factory-phase2-stage-a-20261115',
});

test('Stage A failpoints are inert when no point is requested', () => {
  assert.equal(activeFailpoint({}), null);
  assert.equal(activeFailpoint({ FACTORY_FAULT_POINT: 'none' }), null);
  assert.doesNotThrow(() => hitFailpoint('after-journal-append', {}));
});

test('every declared Stage A failpoint can be selected only in the disposable repository', () => {
  for (const point of STAGE_A_FAILPOINTS) {
    assert.equal(activeFailpoint(valid(point)), point);
    assert.throws(() => hitFailpoint(point, valid(point)), new RegExp(point));
  }
});

test('failpoints reject non-dispatch events, missing opt-in and repository mismatches', () => {
  assert.throws(() => activeFailpoint({ ...valid(), GITHUB_EVENT_NAME: 'issues' }), /workflow_dispatch/);
  assert.throws(() => activeFailpoint({ ...valid(), FACTORY_INTEGRATION_TEST: 'false' }), /INTEGRATION_TEST/);
  assert.throws(() => activeFailpoint({ ...valid(), GITHUB_REPOSITORY: 'owner/production' }), /disposable/);
  assert.throws(() => activeFailpoint({ ...valid(), FACTORY_INTEGRATION_REPOSITORY: 'owner/another-repo' }), /exact/);
  assert.throws(() => activeFailpoint({ ...valid(), FACTORY_FAULT_POINT: 'after-merge' }), /unknown/);
});

test('factory workflow uses the repository-scoped token and guarded dispatch input', () => {
  const workflow = readFileSync(new URL('../workflows/factory.yml', import.meta.url), 'utf8');
  assert.match(workflow, /GITHUB_TOKEN:.*github\.token/);
  assert.doesNotMatch(workflow, /FACTORY_DISPATCHER_GITHUB_TOKEN/);
  assert.match(workflow, /FACTORY_DISPATCHER_LOGIN:.*vars\.FACTORY_DISPATCHER_LOGIN/);
  assert.match(workflow, /FACTORY_FAULT_POINT:.*inputs\.fault_point/);
  assert.match(workflow, /GITHUB_EVENT_NAME:.*github\.event_name/);
  assert.doesNotMatch(workflow, /^\s+queue:/m);
});

test('CI supports explicit exact-main verification after token-authenticated merges', () => {
  const workflow = readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^\s+workflow_dispatch:/m);
});
