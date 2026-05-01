import {
  MAX_SEED_DANCE_REFERENCE_AUDIO_COMPRESSION_RATIO,
  MIN_SEED_DANCE_REFERENCE_AUDIO_DURATION_SECONDS,
  buildDialogueDeliveryConstraint,
  resolveDialogueCompletionTargetSeconds,
  resolveDialogueTimingPlan,
  scaleSubtitleLinesForCompression
} from '../services/dialogueTimingService.js';

describe('dialogueTimingService', () => {
  test('keeps dialogue completion very close to the shot end', () => {
    expect(resolveDialogueCompletionTargetSeconds(2)).toBeLessThan(2);
    expect(resolveDialogueCompletionTargetSeconds(2)).toBeGreaterThanOrEqual(1.97);
    expect(resolveDialogueCompletionTargetSeconds(0.5)).toBeLessThan(0.5);
    expect(resolveDialogueCompletionTargetSeconds(0.5)).toBeGreaterThanOrEqual(0.49);
  });

  test('builds a timing plan that compresses speech into the shot and pads to provider duration', () => {
    const plan = resolveDialogueTimingPlan({
      shotDurationSeconds: 2,
      providerDurationSeconds: 4,
      sourceAudioDurationSeconds: 2.6
    });

    expect(plan.dialogueCompletionTimeSeconds).toBeGreaterThanOrEqual(1.97);
    expect(plan.requiredCompressionRatio).toBeGreaterThan(1);
    expect(plan.requiredCompressionRatio).toBeLessThanOrEqual(MAX_SEED_DANCE_REFERENCE_AUDIO_COMPRESSION_RATIO);
    expect(plan.finalReferenceAudioDurationSeconds).toBe(4);
    expect(plan.providerTailPaddingSeconds).toBeGreaterThan(1.9);
    expect(plan.trimSafetyTailSeconds).toBeLessThanOrEqual(0.03);
  });

  test('keeps provider-tail padding above the minimum reference audio duration when the shot is very short', () => {
    const plan = resolveDialogueTimingPlan({
      shotDurationSeconds: 1,
      providerDurationSeconds: 4,
      estimatedTranscriptDurationSeconds: 0.8
    });

    expect(plan.finalReferenceAudioDurationSeconds).toBeGreaterThanOrEqual(
      MIN_SEED_DANCE_REFERENCE_AUDIO_DURATION_SECONDS
    );
    expect(plan.finalReferenceAudioDurationSeconds).toBe(4);
  });

  test('scales subtitle lines to the compressed active dialogue window', () => {
    const scaledLines = scaleSubtitleLinesForCompression(
      [
        { id: 'line_1', startTime: 0, endTime: 1.2, text: '第一句' },
        { id: 'line_2', startTime: 1.2, endTime: 2.4, text: '第二句' }
      ],
      1.2,
      2
    );

    expect(scaledLines).toEqual([
      {
        id: 'line_1',
        startTime: 0,
        endTime: 1,
        text: '第一句'
      },
      {
        id: 'line_2',
        startTime: 1,
        endTime: 2,
        text: '第二句'
      }
    ]);
  });

  test('builds a delivery constraint that keeps dialogue close to the trim boundary', () => {
    const constraint = buildDialogueDeliveryConstraint({
      shotDurationSeconds: 2,
      dialogueCompletionTimeSeconds: 1.98,
      providerDurationSeconds: 4,
      trimSafetyTailSeconds: 0.02,
      providerTailPaddingSeconds: 2.02,
      requiredCompressionRatio: 1.32
    });

    expect(constraint).toContain('第 1.98 秒附近自然收口');
    expect(constraint).toContain('约 1.32x');
    expect(constraint).toContain('裁回 2.00 秒');
    expect(constraint).toContain('提前说完');
    expect(constraint).toContain('安全垫');
  });
});
