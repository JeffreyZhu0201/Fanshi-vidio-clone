import {
  MAX_SEED_DANCE_REFERENCE_AUDIO_COMPRESSION_RATIO,
  MIN_SEED_DANCE_REFERENCE_AUDIO_DURATION_SECONDS,
  buildDialogueDeliveryConstraint,
  resolveDialogueCompletionTargetSeconds,
  resolveDialogueTimingPlan,
  scaleSubtitleLinesForCompression
} from '../services/dialogueTimingService.js';

describe('dialogueTimingService', () => {
  test('reserves a small trim safety tail inside the requested shot duration', () => {
    expect(resolveDialogueCompletionTargetSeconds(2)).toBeLessThan(2);
    expect(resolveDialogueCompletionTargetSeconds(2)).toBeGreaterThanOrEqual(1.88);
    expect(resolveDialogueCompletionTargetSeconds(0.5)).toBeLessThan(0.5);
  });

  test('builds a timing plan that compresses speech into the shot and pads to provider duration', () => {
    const plan = resolveDialogueTimingPlan({
      shotDurationSeconds: 2,
      providerDurationSeconds: 4,
      sourceAudioDurationSeconds: 2.6
    });

    expect(plan.dialogueCompletionTimeSeconds).toBeLessThan(2);
    expect(plan.requiredCompressionRatio).toBeGreaterThan(1);
    expect(plan.requiredCompressionRatio).toBeLessThanOrEqual(MAX_SEED_DANCE_REFERENCE_AUDIO_COMPRESSION_RATIO);
    expect(plan.finalReferenceAudioDurationSeconds).toBe(4);
    expect(plan.providerTailPaddingSeconds).toBeGreaterThan(1.9);
    expect(plan.trimSafetyTailSeconds).toBeGreaterThan(0);
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

  test('builds a delivery constraint that explicitly guards against tail clipping after trim', () => {
    const constraint = buildDialogueDeliveryConstraint({
      shotDurationSeconds: 2,
      dialogueCompletionTimeSeconds: 1.9,
      providerDurationSeconds: 4,
      trimSafetyTailSeconds: 0.1,
      providerTailPaddingSeconds: 2.1,
      requiredCompressionRatio: 1.32
    });

    expect(constraint).toContain('前 1.90 秒内说完');
    expect(constraint).toContain('约 1.32x');
    expect(constraint).toContain('裁回 2.00 秒');
    expect(constraint).toContain('收口');
    expect(constraint).toContain('无对白缓冲');
  });
});
