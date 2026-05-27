import { describe, expect, it } from 'vitest';
import {
  calculateVoiceLevels,
  calculateVoiceVolume,
  clampVoiceLevel,
  createEmptyVoiceLevels,
} from './audio-levels';

describe('voice audio levels', () => {
  it('clamps and buckets voice levels', () => {
    expect(clampVoiceLevel(-1)).toBe(0);
    expect(clampVoiceLevel(2)).toBe(1);
    expect(createEmptyVoiceLevels(3)).toEqual([0, 0, 0]);

    const levels = calculateVoiceLevels(new Uint8Array([0, 255, 255, 0]), 2);
    expect(levels).toHaveLength(2);
    expect(levels[0]).toBeGreaterThan(0);
    expect(levels[1]).toBeGreaterThan(0);
    expect(calculateVoiceVolume([0, 0.5, 1])).toBeCloseTo(0.5);
  });
});
