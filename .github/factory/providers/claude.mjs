import { fireOutcome } from '../lib.mjs';
import { legacyPayload, makeResult, validateInvocation } from './contract.mjs';

function routine(env, route) {
  const name = route.toUpperCase().replaceAll('-', '_');
  const id = env[`FACTORY_ROUTINE_ID_${name}`];
  const token = env[`FACTORY_FIRE_TOKEN_${name}`];
  return id && token ? { id, token } : { id: env.FACTORY_ROUTINE_ID, token: env.FACTORY_FIRE_TOKEN };
}

export function createClaudeAdapter({ env = process.env, fetchImpl = fetch } = {}) {
  return {
    provider: 'claude',
    availability(route = 'worker') {
      const configured = routine(env, route);
      return configured.id && configured.token
        ? { available: true, authentication: 'claude-routine-token' }
        : { available: false, reason: 'Claude routine id/token is not configured' };
    },
    async invoke(invocation, route = invocation.role) {
      const errors = validateInvocation(invocation);
      if (errors.length) return makeResult(invocation, 'failed', { error: { code: 'invalid-contract', message: errors.join('; ') } });
      const configured = routine(env, route);
      if (!configured.id || !configured.token) return makeResult(invocation, 'unavailable', { error: { code: 'not-configured', message: 'Claude routine is not configured' } });
      try {
        const response = await fetchImpl(`https://api.anthropic.com/v1/claude_code/routines/${configured.id}/fire`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${configured.token}`,
            'anthropic-beta': 'experimental-cc-routine-2026-04-01',
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: legacyPayload(invocation) }),
          signal: AbortSignal.timeout(invocation.timeout_ms),
        });
        let body = null;
        try { body = await response.json(); } catch { /* response body is optional */ }
        if (response.status === 401 || response.status === 403) return makeResult(invocation, 'unauthorized', { error: { code: `http-${response.status}`, message: 'Claude authentication was rejected' } });
        if (response.status === 429) return makeResult(invocation, 'quota-exhausted', { error: { code: 'http-429', message: 'Claude routine quota or rate limit was reached' } });
        const outcome = fireOutcome(response.status);
        if (outcome === 'ok') return makeResult(invocation, 'accepted', { external_id: body?.id ?? body?.session_id ?? null });
        if (outcome === 'refused') return makeResult(invocation, 'refused', { error: { code: `http-${response.status}`, message: 'Claude routine refused the invocation' } });
        return makeResult(invocation, 'unknown', { error: { code: `http-${response.status}`, message: 'Claude routine outcome is unknown' } });
      } catch (error) {
        const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        return makeResult(invocation, timeout ? 'timeout' : 'unknown', { error: { code: timeout ? 'timeout' : 'network', message: error.message } });
      }
    },
  };
}
