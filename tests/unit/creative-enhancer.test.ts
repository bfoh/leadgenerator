import { afterEach, describe, expect, it } from 'vitest';
import { CREATIVE_DEMOS, runCreativeDemo } from '@/lib/domain/creative-demos';
import { creativeEnhancementStatus, enhanceCreativeDirection } from '@/lib/server/providers/creative';

// The optional AI enhancement boundary: it exists, it is visible, and it refuses to call anything in
// this milestone. No provider request is made, configured or not.

const ORIGINAL = { enabled: process.env.CREATIVE_DIRECTOR_AI, key: process.env.ANTHROPIC_API_KEY };

afterEach(() => {
  if (ORIGINAL.enabled === undefined) delete process.env.CREATIVE_DIRECTOR_AI;
  else process.env.CREATIVE_DIRECTOR_AI = ORIGINAL.enabled;
  if (ORIGINAL.key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL.key;
});

describe('the optional creative enhancement boundary', () => {
  it('is disabled by default and names what would be required', () => {
    delete process.env.CREATIVE_DIRECTOR_AI;
    delete process.env.ANTHROPIC_API_KEY;
    const status = creativeEnhancementStatus();
    expect(status.available).toBe(false);
    expect(status.enabled).toBe(false);
    expect(status.provider).toBeNull();
    expect(status.reason).toContain('CREATIVE_DIRECTOR_AI=true');
  });

  it('stays unavailable when enabled without a key, or with a key but no implementation', () => {
    process.env.CREATIVE_DIRECTOR_AI = 'true';
    delete process.env.ANTHROPIC_API_KEY;
    expect(creativeEnhancementStatus()).toMatchObject({ available: false, enabled: true, keyPresent: false, provider: null });

    process.env.ANTHROPIC_API_KEY = 'test-key';
    const status = creativeEnhancementStatus();
    expect(status.available).toBe(false);
    expect(status.provider).toBe('anthropic');
    expect(status.reason).toContain('no enhancement provider is implemented');
  });

  it('refuses every enhancement request, so the deterministic engine remains authoritative', async () => {
    const result = runCreativeDemo(CREATIVE_DEMOS[0]);
    process.env.CREATIVE_DIRECTOR_AI = 'true';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    await expect(enhanceCreativeDirection({ brief: result.brief, direction: result.direction, instruction: 'Make it more cinematic.' })).rejects.toThrow(/not implemented/i);

    delete process.env.CREATIVE_DIRECTOR_AI;
    await expect(enhanceCreativeDirection({ brief: result.brief, direction: result.direction, instruction: 'Make it more cinematic.' })).rejects.toThrow(/disabled/i);
  });
});
