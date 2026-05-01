const MIN_DIALOGUE_ACTIVE_DURATION_SECONDS = 0.25;
const MIN_DIALOGUE_COMPLETION_MARGIN_SECONDS = 0.01;
const MAX_DIALOGUE_COMPLETION_MARGIN_SECONDS = 0.03;
const DIALOGUE_COMPLETION_MARGIN_RATIO = 0.01;
const MIN_SEED_DANCE_REFERENCE_AUDIO_DURATION_SECONDS = 1.8;
const MAX_SEED_DANCE_REFERENCE_AUDIO_COMPRESSION_RATIO = 1.5;

const normalizePositiveDuration = (value, fallbackValue = 0) => {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return Number(fallbackValue) > 0 ? Number(fallbackValue) : 0;
  }

  return Number(parsedValue.toFixed(3));
};

const resolveDialogueCompletionTargetSeconds = (shotDurationSeconds) => {
  const safeShotDurationSeconds = Math.max(0.3, normalizePositiveDuration(shotDurationSeconds, 0.3));
  const safetyMarginSeconds = Math.min(
    MAX_DIALOGUE_COMPLETION_MARGIN_SECONDS,
    Math.max(MIN_DIALOGUE_COMPLETION_MARGIN_SECONDS, safeShotDurationSeconds * DIALOGUE_COMPLETION_MARGIN_RATIO)
  );

  return Number(
    Math.max(MIN_DIALOGUE_ACTIVE_DURATION_SECONDS, safeShotDurationSeconds - safetyMarginSeconds).toFixed(3)
  );
};

const resolveDialogueTimingPlan = ({
  shotDurationSeconds,
  providerDurationSeconds = 0,
  sourceAudioDurationSeconds = 0,
  estimatedTranscriptDurationSeconds = 0,
  minReferenceAudioDurationSeconds = MIN_SEED_DANCE_REFERENCE_AUDIO_DURATION_SECONDS
} = {}) => {
  const safeShotDurationSeconds = Math.max(0.3, normalizePositiveDuration(shotDurationSeconds, 0.3));
  const safeProviderDurationSeconds = Math.max(
    safeShotDurationSeconds,
    normalizePositiveDuration(providerDurationSeconds, safeShotDurationSeconds)
  );
  const dialogueCompletionTimeSeconds = Math.min(
    safeShotDurationSeconds,
    resolveDialogueCompletionTargetSeconds(safeShotDurationSeconds)
  );
  const effectiveDialogueSourceDurationSeconds = Math.max(
    0,
    normalizePositiveDuration(sourceAudioDurationSeconds, 0),
    normalizePositiveDuration(estimatedTranscriptDurationSeconds, 0)
  );
  const requiredCompressionRatio =
    effectiveDialogueSourceDurationSeconds > 0
      ? Number((effectiveDialogueSourceDurationSeconds / dialogueCompletionTimeSeconds).toFixed(3))
      : 1;
  const finalReferenceAudioDurationSeconds = Number(
    Math.max(
      dialogueCompletionTimeSeconds,
      safeProviderDurationSeconds,
      normalizePositiveDuration(minReferenceAudioDurationSeconds, MIN_SEED_DANCE_REFERENCE_AUDIO_DURATION_SECONDS)
    ).toFixed(3)
  );

  return {
    shotDurationSeconds: Number(safeShotDurationSeconds.toFixed(3)),
    providerDurationSeconds: Number(safeProviderDurationSeconds.toFixed(3)),
    dialogueCompletionTimeSeconds: Number(dialogueCompletionTimeSeconds.toFixed(3)),
    trimSafetyTailSeconds: Number(Math.max(0, safeShotDurationSeconds - dialogueCompletionTimeSeconds).toFixed(3)),
    finalReferenceAudioDurationSeconds,
    providerTailPaddingSeconds: Number(
      Math.max(0, finalReferenceAudioDurationSeconds - dialogueCompletionTimeSeconds).toFixed(3)
    ),
    effectiveDialogueSourceDurationSeconds: Number(effectiveDialogueSourceDurationSeconds.toFixed(3)),
    requiredCompressionRatio
  };
};

const scaleSubtitleLinesForCompression = (subtitleLines = [], compressionRatio = 1, targetDurationSeconds = 0) => {
  if (!Array.isArray(subtitleLines) || !subtitleLines.length) {
    return [];
  }

  const safeCompressionRatio = Number(compressionRatio);
  const safeTargetDurationSeconds = Math.max(0.3, Number(targetDurationSeconds) || 0.3);

  if (!Number.isFinite(safeCompressionRatio) || safeCompressionRatio <= 0) {
    return subtitleLines;
  }

  return subtitleLines.map((line, lineIndex) => {
    const scaledStartTime = Math.max(0, Number(line.startTime ?? 0) / safeCompressionRatio);
    const scaledEndTime = Math.max(
      scaledStartTime + 0.05,
      Number(line.endTime ?? line.startTime ?? 0) / safeCompressionRatio
    );

    return {
      id: String(line.id ?? `subtitle_${lineIndex + 1}`),
      startTime: Number(Math.min(safeTargetDurationSeconds, scaledStartTime).toFixed(2)),
      endTime: Number(Math.min(safeTargetDurationSeconds, scaledEndTime).toFixed(2)),
      text: String(line.text ?? '').trim()
    };
  });
};

const buildDialogueDeliveryConstraint = ({
  shotDurationSeconds,
  dialogueCompletionTimeSeconds,
  providerDurationSeconds,
  trimSafetyTailSeconds,
  providerTailPaddingSeconds,
  requiredCompressionRatio
} = {}) => {
  const safeShotDurationSeconds = normalizePositiveDuration(shotDurationSeconds, 0);
  const safeDialogueCompletionTimeSeconds = normalizePositiveDuration(dialogueCompletionTimeSeconds, 0);
  const safeProviderDurationSeconds = normalizePositiveDuration(providerDurationSeconds, 0);
  const safeTrimSafetyTailSeconds = Math.max(0, normalizePositiveDuration(trimSafetyTailSeconds, 0));
  const safeProviderTailPaddingSeconds = Math.max(0, normalizePositiveDuration(providerTailPaddingSeconds, 0));
  const safeCompressionRatio = Number(requiredCompressionRatio) || 1;
  const constraints = [];

  if (safeDialogueCompletionTimeSeconds > 0 && safeShotDurationSeconds > 0) {
    constraints.push(
      `完整对白必须尽量覆盖当前镜头的有效时长，并在第 ${safeDialogueCompletionTimeSeconds.toFixed(2)} 秒附近自然收口。`
    );
  }

  if (safeCompressionRatio > 1.02) {
    constraints.push(`允许适度加快语速到约 ${safeCompressionRatio.toFixed(2)}x，并压缩停顿。`);
  }

  if (safeTrimSafetyTailSeconds > 0.02) {
    constraints.push(
      `镜头结尾只保留约 ${safeTrimSafetyTailSeconds.toFixed(2)} 秒极短收口余量，不要提前长时间闭口。`
    );
  }

  if (safeProviderDurationSeconds > safeShotDurationSeconds + 0.05) {
    constraints.push(
      `如果供应商内部按 ${safeProviderDurationSeconds.toFixed(2)} 秒生成后再裁回 ${safeShotDurationSeconds.toFixed(
        2
      )} 秒，完整对白也必须尽量覆盖到裁切点附近，不要在当前镜头中前段提前说完。`
    );
  }

  if (safeProviderTailPaddingSeconds > 0.05) {
    constraints.push(
      `若供应商内部生成时长更长，额外时长只作为防止尾字被裁掉的安全垫，不代表当前镜头里需要长时间静音。`
    );
  }

  return constraints.join(' ');
};

export {
  MAX_SEED_DANCE_REFERENCE_AUDIO_COMPRESSION_RATIO,
  MIN_SEED_DANCE_REFERENCE_AUDIO_DURATION_SECONDS,
  buildDialogueDeliveryConstraint,
  resolveDialogueCompletionTargetSeconds,
  resolveDialogueTimingPlan,
  scaleSubtitleLinesForCompression
};
