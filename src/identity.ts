/**
 * identity.ts - Self Protocol ZK identity gate for Cloak
 *
 * Verifies agent identity using Self Protocol's ZK-powered Agent ID
 * before granting access to vault execution.
 *
 * Self Protocol: https://app.ai.self.xyz
 */

export interface IdentityVerificationResult {
  verified: boolean;
  agentId?: string;
  reason?: string;
}

export async function verifyAgentIdentity(
  selfAgentId: string | undefined
): Promise<IdentityVerificationResult> {
  const strictMode = process.env['SELF_STRICT_MODE'] === 'true';

  if (!selfAgentId || selfAgentId.trim() === '') {
    if (strictMode) {
      return {
        verified: false,
        reason: 'No Self Agent ID provided. Set SELF_STRICT_MODE=false to allow unauthenticated access in development.',
      };
    }
    console.warn('[Cloak] No Self Agent ID provided — running in permissive mode.');
    return { verified: true, reason: 'Permissive mode: no Self Agent ID required.' };
  }

  try {
    const res = await fetch('https://app.ai.self.xyz/api/agent/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: selfAgentId }),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        verified: boolean;
        agentId?: string;
        reason?: string;
      };
      return {
        verified: data.verified,
        agentId: data.agentId ?? selfAgentId,
        reason: data.verified ? undefined : (data.reason ?? 'Self Protocol verification failed.'),
      };
    }

    const errorText = await res.text().catch(() => '');
    console.warn(`[Cloak] Self Protocol returned HTTP ${res.status}: ${errorText}`);
    if (strictMode) {
      return { verified: false, reason: `Self Protocol returned HTTP ${res.status}.` };
    }
    return { verified: true, agentId: selfAgentId, reason: `Permissive mode: Self Protocol returned HTTP ${res.status}.` };

  } catch (err) {
    console.warn('[Cloak] Self Protocol unreachable:', err);
    if (strictMode) {
      return { verified: false, reason: `Self Protocol unreachable: ${String(err)}` };
    }
    return { verified: true, agentId: selfAgentId, reason: 'Permissive mode: Self Protocol unreachable.' };
  }
}
