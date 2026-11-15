import { makeResult, validateInvocation } from './contract.mjs';

function trustedRunnerUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname));
  } catch { return false; }
}

export function createCodexAdapter({ env = process.env, fetchImpl = fetch } = {}) {
  return {
    provider: 'codex',
    availability() {
      if (!trustedRunnerUrl(env.FACTORY_CODEX_RUNNER_URL)) return { available: false, reason: 'A trusted HTTPS or loopback Codex runner URL is required' };
      if (!env.FACTORY_CODEX_RUNNER_TOKEN) return { available: false, reason: 'Codex runner token is not configured' };
      return { available: true, authentication: 'runner-token; Codex subscription auth stays on the runner' };
    },
    async invoke(invocation) {
      const errors = validateInvocation(invocation);
      if (errors.length) return makeResult(invocation, 'failed', { error: { code: 'invalid-contract', message: errors.join('; ') } });
      const available = this.availability();
      if (!available.available) return makeResult(invocation, 'unavailable', { error: { code: 'not-configured', message: available.reason } });
      try {
        const response = await fetchImpl(env.FACTORY_CODEX_RUNNER_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${env.FACTORY_CODEX_RUNNER_TOKEN}`, 'content-type': 'application/json' },
          body: JSON.stringify(invocation),
          signal: AbortSignal.timeout(invocation.timeout_ms),
        });
        let body = null;
        try { body = await response.json(); } catch { /* handled below */ }
        if (response.status === 401 || response.status === 403) return makeResult(invocation, 'unauthorized', { error: { code: `http-${response.status}`, message: 'Codex runner authentication was rejected' } });
        if (response.status === 409) return makeResult(invocation, 'refused', { error: { code: 'busy', message: 'Codex runner is busy or invocation conflicts' } });
        if (response.status === 429 || body?.code === 'quota-exhausted') return makeResult(invocation, 'quota-exhausted', { error: { code: 'quota-exhausted', message: body?.message ?? 'Codex subscription quota is exhausted' } });
        if (!response.ok) return makeResult(invocation, response.status >= 500 ? 'unknown' : 'failed', { error: { code: `http-${response.status}`, message: body?.message ?? 'Codex runner rejected the invocation' } });
        if (body?.invocation_id && body.invocation_id !== invocation.id) return makeResult(invocation, 'failed', { error: { code: 'mismatched-result', message: 'Codex runner returned another invocation id' } });
        return makeResult(invocation, body?.status === 'completed' ? 'completed' : 'accepted', { external_id: body?.run_id ?? null, usage: body?.usage ?? null, output: body?.output ?? null });
      } catch (error) {
        const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        return makeResult(invocation, timeout ? 'timeout' : 'unavailable', { error: { code: timeout ? 'timeout' : 'runner-unreachable', message: error.message } });
      }
    },
  };
}
