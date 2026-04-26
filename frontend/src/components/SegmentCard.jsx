import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import ModalSheet from './ModalSheet.jsx';
import ProgressBar from './ProgressBar.jsx';
import PromptEditor from './PromptEditor.jsx';
import PromptPreview from './PromptPreview.jsx';
import StatusBadge from './StatusBadge.jsx';
import VideoFramePreview from './VideoFramePreview.jsx';
import { useAppStore } from '../store/appStore.js';
import { formatDuration } from '../utils/formatDuration.js';
import { tokenizePrompt } from '../utils/mentionTokens.js';
import {
  buildPromptOptimizationPrompt,
  buildSegmentAnalysisPromptSections,
  expandResourceMentions
} from '../utils/promptBlueprints.js';
import {
  DEFAULT_STYLE_MODE,
  STYLE_MODE_LABELS,
  STYLE_MODE_OPTIONS,
  getEditableStyleTemplateDefaults,
  normalizeStyleMode,
  resolveStyleTemplate
} from '../../../shared/styleTemplates.js';

const getNormalizedFrameTime = (value) => {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null;
  }

  return Number(parsedValue.toFixed(2));
};

const clampTime = (value, min, max) => {
  return Math.max(min, Math.min(value, max));
};

const getBackgroundActionLabel = (backgroundAction) => {
  return backgroundAction === 'reuse_existing' ? '复用背景' : '新建场景';
};

const getBackgroundActionStatus = (backgroundAction) => {
  return backgroundAction === 'reuse_existing' ? 'completed' : 'processing';
};

const getBackgroundAssetStatusLabel = (backgroundAsset) => {
  if (!backgroundAsset) {
    return '待创建资产';
  }

  if (backgroundAsset.status === 'completed') {
    return '背景资产已就绪';
  }

  if (backgroundAsset.status === 'failed') {
    return '背景资产失败';
  }

  if (backgroundAsset.status === 'processing') {
    return '背景资产生成中';
  }

  return '等待生成';
};

const getShotAssemblyStatusLabel = (summary) => {
  if (!summary) {
    return '镜头待生成';
  }

  if (summary.status === 'completed') {
    return '镜头拼回完成';
  }

  if (summary.status === 'failed') {
    return '镜头拼回失败';
  }

  if (summary.status === 'processing' || summary.pending_assembly) {
    return '镜头批量处理中';
  }

  if (summary.completed_shot_count > 0) {
    return `已完成 ${summary.completed_shot_count}/${summary.total_shot_count || 0}`;
  }

  return '镜头待生成';
};

const getGenerationTaskStatusLabel = (task, fallbackLabel = '视频待生成') => {
  if (!task) {
    return fallbackLabel;
  }

  if (task.status === 'completed') {
    return '视频生成完成';
  }

  if (task.status === 'failed') {
    return '视频生成失败';
  }

  if (task.remote_status_label) {
    return task.remote_status_label;
  }

  if (task.status === 'processing') {
    return '视频生成中';
  }

  if (task.status === 'pending') {
    return '视频排队中';
  }

  return fallbackLabel;
};

const shouldShowGenerationProgress = (task) => {
  if (!task) {
    return false;
  }

  return ['pending', 'processing', 'completed', 'failed'].includes(task.status);
};

const getTaskReferenceItems = (task, key) => {
  return Array.isArray(task?.[key]) ? task[key].filter(Boolean) : [];
};

const TaskReferenceDebugPanel = ({ task }) => {
  const imageItems = getTaskReferenceItems(task, 'sent_reference_images');
  const videoItems = getTaskReferenceItems(task, 'sent_reference_videos');
  const audioItems = getTaskReferenceItems(task, 'sent_reference_audios');
  const useReferenceVideo = task?.use_reference_video !== false;
  const groups = [
    { label: '参考图', items: imageItems },
    { label: '参考视频', items: videoItems },
    { label: '参考音频', items: audioItems }
  ].filter((group) => group.items.length);

  if (!groups.length && useReferenceVideo) {
    return null;
  }

  return (
    <div className="mt-2 space-y-2 rounded-[12px] border border-white/8 bg-black/15 px-3 py-2">
      {!useReferenceVideo ? (
        <p className="text-[11px] leading-5 text-white/65">本次生成已关闭原片参考视频，只使用其它参考素材。</p>
      ) : null}
      {groups.map((group) => (
        <div key={group.label} className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
            {group.label} {group.items.length}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {group.items.map((item, index) => (
              <span
                key={`${group.label}-${item.label || item.source_kind || index}`}
                className="inline-flex rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] leading-4 text-white/78"
                title={item.resolved_url || ''}
              >
                {item.label || item.source_kind || `${group.label} ${index + 1}`}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

TaskReferenceDebugPanel.propTypes = {
  task: PropTypes.shape({
    use_reference_video: PropTypes.bool,
    sent_reference_images: PropTypes.arrayOf(PropTypes.object),
    sent_reference_videos: PropTypes.arrayOf(PropTypes.object),
    sent_reference_audios: PropTypes.arrayOf(PropTypes.object)
  })
};

const renderPromptTokenPreview = (value = '') => {
  return tokenizePrompt(value).map((token, index) => {
    if (token.type === 'character-mention' || token.type === 'scene-mention') {
      return (
        <span
          key={`${token.value}-${index}`}
          className={`mx-0.5 inline-flex rounded-full px-1.5 py-0.5 font-semibold ${
            token.type === 'scene-mention'
              ? 'border border-amber-500/25 bg-amber-500/10 text-amber-100'
              : 'border border-brand-500/20 bg-brand-500/10 text-brand-100'
          }`}
        >
          {token.value}
        </span>
      );
    }

    return <span key={`${token.value}-${index}`}>{token.value}</span>;
  });
};

const splitNameInput = (value = '') => {
  return String(value ?? '')
    .split(/[，,\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
};

const formatSubtitleTimestamp = (value) => {
  const safeValue = Math.max(0, Number(value) || 0);
  const hours = Math.floor(safeValue / 3600);
  const minutes = Math.floor((safeValue % 3600) / 60);
  const seconds = Math.floor(safeValue % 60);
  const milliseconds = Math.round((safeValue - Math.floor(safeValue)) * 1000);

  return [hours, minutes, seconds]
    .map((item) => String(item).padStart(2, '0'))
    .join(':')
    .concat(',', String(milliseconds).padStart(3, '0'));
};

const buildSrtFromSubtitleLines = (subtitleLines = []) => {
  return (Array.isArray(subtitleLines) ? subtitleLines : [])
    .map((line, index) => {
      return [
        String(index + 1),
        `${formatSubtitleTimestamp(line.startTime)} --> ${formatSubtitleTimestamp(line.endTime)}`,
        String(line.text ?? '').trim()
      ].join('\n');
    })
    .join('\n\n');
};

const normalizeSubtitleLineEditorItem = (line = {}, index = 0) => ({
  id: String(line?.id ?? `subtitle_${index + 1}`),
  startTime: toEditorString(line?.startTime, '0.00'),
  endTime: toEditorString(line?.endTime, '0.50'),
  text: String(line?.text ?? '').trim()
});

const normalizeSpeechEditorState = (speech = null) => ({
  transcript: String(speech?.transcript ?? '').trim(),
  subtitleLines: Array.isArray(speech?.subtitleLines)
    ? speech.subtitleLines.map((line, index) => normalizeSubtitleLineEditorItem(line, index))
    : [],
  speechStyle: String(speech?.speechStyle ?? '').trim(),
  hasDialogue: Boolean(speech?.hasDialogue),
  extractionStatus: String(speech?.extractionStatus ?? 'idle').trim() || 'idle',
  extractionError: String(speech?.extractionError ?? '').trim(),
  subtitleFilePath: String(speech?.subtitleFilePath ?? '').trim(),
  subtitleFileUrl: String(speech?.subtitleFileUrl ?? '').trim(),
  sourceOfTruth: String(speech?.sourceOfTruth ?? 'extracted').trim() || 'extracted'
});

const normalizeCharacterStateRefEditorItem = (stateRef = {}) => ({
  characterName: String(stateRef?.characterName ?? '').trim(),
  stateId: String(stateRef?.stateId ?? '').trim(),
  stateName: String(stateRef?.stateName ?? '').trim(),
  summary: String(stateRef?.summary ?? '').trim(),
  continuityPrompt: String(stateRef?.continuityPrompt ?? '').trim(),
  representativeFrameTime: toEditorString(stateRef?.representativeFrameTime, ''),
  representativeFrameImagePath: String(stateRef?.representativeFrameImagePath ?? '').trim(),
  representativeFrameImageUrl: String(stateRef?.representativeFrameImageUrl ?? '').trim()
});

const copyToClipboard = async (value = '') => {
  if (!navigator?.clipboard?.writeText) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(String(value ?? ''));
    return true;
  } catch (error) {
    return false;
  }
};

const toEditorString = (value, fallback = '') => {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  return String(value);
};

const buildShotEditorItem = (shot, shotIndex = 0) => ({
  id: String(shot?.id ?? `shot_${shotIndex + 1}`),
  shotIndex: Number(shot?.shotIndex ?? shotIndex) || shotIndex,
  startTime: toEditorString(shot?.startTime, ''),
  endTime: toEditorString(shot?.endTime, ''),
  localStartTime: toEditorString(shot?.localStartTime, ''),
  localEndTime: toEditorString(shot?.localEndTime, ''),
  durationSeconds: toEditorString(shot?.durationSeconds, ''),
  summary: String(shot?.summary ?? '').trim(),
  prompt: String(shot?.prompt ?? '').trim(),
  sceneNamesInput: (shot?.sceneNames ?? []).join(', '),
  characterNamesInput: (shot?.characterNames ?? []).join(', '),
  representativeFrameTime: toEditorString(shot?.representativeFrameTime, ''),
  representativeFrameNote: String(shot?.representativeFrameNote ?? '').trim(),
  sourceFilePath: String(shot?.sourceFilePath ?? '').trim(),
  sourceFileUrl: String(shot?.sourceFileUrl ?? '').trim(),
  sourceLocalStartTime: toEditorString(shot?.sourceLocalStartTime, ''),
  sourceLocalEndTime: toEditorString(shot?.sourceLocalEndTime, ''),
  representativeFrameImagePath: String(shot?.representativeFrameImagePath ?? '').trim(),
  representativeFrameImageUrl: String(shot?.representativeFrameImageUrl ?? '').trim(),
  representativeFrameActualTime: toEditorString(shot?.representativeFrameActualTime, ''),
  sourceAudioFilePath: String(shot?.sourceAudioFilePath ?? '').trim(),
  sourceAudioFileUrl: String(shot?.sourceAudioFileUrl ?? '').trim(),
  speech: normalizeSpeechEditorState(shot?.speech ?? null),
  characterStateRefs: Array.isArray(shot?.characterStateRefs)
    ? shot.characterStateRefs.map((stateRef) => normalizeCharacterStateRefEditorItem(stateRef))
    : [],
  generatedUrl: shot?.generatedUrl ?? '',
  latestGenerationTask: shot?.latestGenerationTask ?? null,
  latestCompletedGenerationTask: shot?.latestCompletedGenerationTask ?? null,
  isNew: false
});

const buildNewShotEditorItem = (segment, currentShots = []) => {
  const minDuration = 0.3;
  const segmentStartTime = Number(segment.startTime ?? 0);
  const segmentEndTime = Number(segment.endTime ?? segmentStartTime + minDuration);
  const lastShot = [...currentShots]
    .map((shot) => ({
      startTime: Number(shot.startTime),
      endTime: Number(shot.endTime)
    }))
    .filter((shot) => Number.isFinite(shot.startTime) && Number.isFinite(shot.endTime))
    .sort((left, right) => left.startTime - right.startTime)
    .at(-1);
  const nextStartTime = lastShot?.endTime
    ? Math.min(Math.max(segmentStartTime, lastShot.endTime), Math.max(segmentStartTime, segmentEndTime - minDuration))
    : segmentStartTime;
  const nextEndTime = Math.min(segmentEndTime, Math.max(nextStartTime + minDuration, nextStartTime + 1));
  const representativeFrameTime = Number(((nextStartTime + nextEndTime) / 2).toFixed(2));

  return {
    id: `temp-shot-${Date.now()}-${currentShots.length + 1}`,
    shotIndex: currentShots.length,
    startTime: nextStartTime.toFixed(2),
    endTime: nextEndTime.toFixed(2),
    localStartTime: Math.max(0, nextStartTime - segmentStartTime).toFixed(2),
    localEndTime: Math.max(0, nextEndTime - segmentStartTime).toFixed(2),
    durationSeconds: Math.max(minDuration, nextEndTime - nextStartTime).toFixed(2),
    summary: '',
    prompt: '',
    sceneNamesInput: '',
    characterNamesInput: '',
    representativeFrameTime: representativeFrameTime.toFixed(2),
    representativeFrameNote: '',
    sourceFilePath: '',
    sourceFileUrl: '',
    sourceLocalStartTime: '',
    sourceLocalEndTime: '',
    representativeFrameImagePath: '',
    representativeFrameImageUrl: '',
    representativeFrameActualTime: '',
    sourceAudioFilePath: '',
    sourceAudioFileUrl: '',
    speech: normalizeSpeechEditorState({
      transcript: '',
      subtitleLines: [],
      speechStyle: '',
      hasDialogue: false,
      extractionStatus: 'idle',
      extractionError: '',
      subtitleFilePath: '',
      subtitleFileUrl: '',
      sourceOfTruth: 'edited_text'
    }),
    characterStateRefs: [],
    generatedUrl: '',
    latestGenerationTask: null,
    latestCompletedGenerationTask: null,
    isNew: true
  };
};

const ShotSourcePreview = ({ sourceFileUrl = '', fallbackLabel = '保存后将生成独立小镜头源预览。' }) => {
  if (sourceFileUrl) {
    return (
      <div className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">源镜头预览</p>
        <video className="segment-workbench-video mt-2" src={sourceFileUrl} controls preload="metadata" />
      </div>
    );
  }

  return (
    <div className="rounded-[16px] border border-dashed border-white/10 bg-black/10 px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">源镜头预览</p>
      <div className="preview-placeholder segment-workbench-empty mt-2 min-h-[140px]">
        <div className="preview-orb" />
        <p className="text-sm font-semibold text-white">待生成源镜头</p>
        <p className="mt-2 max-w-[220px] text-center text-[11px] leading-5 text-white/60">{fallbackLabel}</p>
      </div>
    </div>
  );
};

const ShotRepresentativeFramePreview = ({
  representativeFrameImageUrl = '',
  representativeFrameNote = '',
  fallbackVideoUrl = '',
  fallbackTimeSeconds = null,
  originalTimeSeconds = null,
  label = '镜头典型帧'
}) => {
  if (representativeFrameImageUrl) {
    return (
      <div className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">{label}</p>
        <img
          src={representativeFrameImageUrl}
          alt={label}
          className="mt-2 h-[150px] w-full rounded-[14px] border border-white/10 object-cover"
        />
        <p className="mt-2 text-[11px] leading-5 text-white/58">
          {representativeFrameNote || '该图会作为当前小镜头的生成参考图。'}
        </p>
      </div>
    );
  }

  return (
    <VideoFramePreview
      videoUrl={fallbackVideoUrl}
      timeSeconds={fallbackTimeSeconds}
      originalTimeSeconds={originalTimeSeconds}
      label={label}
      note={representativeFrameNote || '持久化典型帧缺失，当前回退为动态抽帧。'}
      requestedTimeLabel="镜头时间"
    />
  );
};

const normalizeShotDraftForSave = (shotDraft) => ({
  id: String(shotDraft.id ?? '').trim(),
  startTime: Number(shotDraft.startTime),
  endTime: Number(shotDraft.endTime),
  summary: String(shotDraft.summary ?? '').trim(),
  prompt: String(shotDraft.prompt ?? '').trim(),
  sceneNames: splitNameInput(shotDraft.sceneNamesInput),
  characterNames: splitNameInput(shotDraft.characterNamesInput),
  representativeFrameTime: String(shotDraft.representativeFrameTime ?? '').trim()
    ? Number(shotDraft.representativeFrameTime)
    : null,
  representativeFrameNote: String(shotDraft.representativeFrameNote ?? '').trim(),
  speech: {
    transcript: String(shotDraft.speech?.transcript ?? '').trim(),
    subtitleLines: Array.isArray(shotDraft.speech?.subtitleLines)
      ? shotDraft.speech.subtitleLines
          .map((line, lineIndex) => ({
            id: String(line?.id ?? `subtitle_${lineIndex + 1}`),
            startTime: Number(line?.startTime),
            endTime: Number(line?.endTime),
            text: String(line?.text ?? '').trim()
          }))
          .filter((line) => line.text)
      : [],
    speechStyle: String(shotDraft.speech?.speechStyle ?? '').trim(),
    hasDialogue: Boolean(shotDraft.speech?.hasDialogue),
    extractionStatus: String(shotDraft.speech?.extractionStatus ?? 'completed').trim() || 'completed',
    extractionError: String(shotDraft.speech?.extractionError ?? '').trim(),
    subtitleFilePath: String(shotDraft.speech?.subtitleFilePath ?? '').trim(),
    subtitleFileUrl: String(shotDraft.speech?.subtitleFileUrl ?? '').trim(),
    sourceOfTruth: String(shotDraft.speech?.sourceOfTruth ?? 'edited_text').trim() || 'edited_text'
  },
  characterStateRefs: Array.isArray(shotDraft.characterStateRefs)
    ? shotDraft.characterStateRefs
        .map((stateRef) => ({
          characterName: String(stateRef?.characterName ?? '').trim(),
          stateId: String(stateRef?.stateId ?? '').trim(),
          stateName: String(stateRef?.stateName ?? '').trim(),
          summary: String(stateRef?.summary ?? '').trim(),
          continuityPrompt: String(stateRef?.continuityPrompt ?? '').trim(),
          representativeFrameTime: String(stateRef?.representativeFrameTime ?? '').trim()
            ? Number(stateRef.representativeFrameTime)
            : null,
          representativeFrameImagePath: String(stateRef?.representativeFrameImagePath ?? '').trim(),
          representativeFrameImageUrl: String(stateRef?.representativeFrameImageUrl ?? '').trim()
        }))
        .filter((stateRef) => stateRef.characterName)
    : []
});

const normalizeShotDraftForRebuildCheck = (shotDraft) => ({
  id: String(shotDraft.id ?? '').trim(),
  startTime: Number(shotDraft.startTime),
  endTime: Number(shotDraft.endTime),
  representativeFrameTime: String(shotDraft.representativeFrameTime ?? '').trim()
    ? Number(shotDraft.representativeFrameTime)
    : null
});

const shouldPersistShotDraftsBeforeGeneration = (shotDrafts = [], persistedShots = []) => {
  if (!Array.isArray(shotDrafts) || !shotDrafts.length) {
    return false;
  }

  if (!Array.isArray(persistedShots) || shotDrafts.length !== persistedShots.length) {
    return true;
  }

  return shotDrafts.some((shotDraft, shotIndex) => {
    if (shotDraft?.isNew || String(shotDraft?.id ?? '').startsWith('temp-shot-')) {
      return true;
    }

    const currentPersistedShot = persistedShots[shotIndex];

    if (!currentPersistedShot) {
      return true;
    }

    return (
      JSON.stringify(normalizeShotDraftForSave(shotDraft)) !==
      JSON.stringify(normalizeShotDraftForSave(currentPersistedShot))
    );
  });
};

const buildShotRebuildSignature = (shots = []) => {
  if (!Array.isArray(shots)) {
    return '[]';
  }

  return JSON.stringify(shots.map((shot) => normalizeShotDraftForRebuildCheck(shot)));
};

const SegmentCard = ({
  segment,
  overallAnalysis = null,
  analysisOptions = null,
  onAnalysisOptionsChange = () => {},
  timeAnchor = null,
  backgroundAsset = null,
  expanded = false,
  onToggle = () => {},
  onPromptChange = () => {},
  onAnalyze = () => {},
  onOptimize = () => {},
  onOptimizeShot = async () => null,
  onGenerate = () => {},
  onShotPromptChange = () => {},
  onGenerateShot = () => {},
  onGenerateAllShots = () => {},
  onSaveShots = async () => null,
  isAnalyzing = false,
  isOptimizing = false,
  isGenerating = false,
  generatingShotKeys = [],
  isBatchGenerating = false,
  optimizingShotKeys = [],
  isSavingShots = false
}) => {
  const [draftPrompt, setDraftPrompt] = useState(segment.prompt ?? '');
  const [useReferenceVideo, setUseReferenceVideo] = useState(false);
  const [shotEditorItems, setShotEditorItems] = useState(() =>
    (segment.shots ?? []).map((shot, shotIndex) => buildShotEditorItem(shot, shotIndex))
  );
  const [persistedShotBaseline, setPersistedShotBaseline] = useState(() =>
    (segment.shots ?? []).map((shot, shotIndex) => buildShotEditorItem(shot, shotIndex))
  );
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [editorBanner, setEditorBanner] = useState('');
  const seedDanceProvider = useAppStore((state) => state.providerStatuses.seedance);
  const characters = overallAnalysis?.characters ?? [];
  const backgrounds = overallAnalysis?.backgrounds ?? [];
  const resolvedAnalysisOptions = analysisOptions ?? overallAnalysis?.analysis_options ?? overallAnalysis?.analysisOptions ?? null;
  const currentStyleMode = normalizeStyleMode(
    resolvedAnalysisOptions?.styleMode ?? resolvedAnalysisOptions?.style_mode ?? DEFAULT_STYLE_MODE
  );
  const currentStyleLabel = STYLE_MODE_LABELS[currentStyleMode] ?? STYLE_MODE_LABELS[DEFAULT_STYLE_MODE];
  const currentStyleTemplates =
    resolvedAnalysisOptions?.styleTemplates ??
    resolvedAnalysisOptions?.style_templates ??
    getEditableStyleTemplateDefaults();
  const segmentShots = Array.isArray(segment.shots) ? segment.shots : [];
  const segmentShotRebuildSignature = buildShotRebuildSignature(segmentShots);
  const shotGenerationSummary = segment.shotGenerationSummary ?? segment.latestShotAssemblyTask ?? null;
  const originalSegmentSummary =
    timeAnchor?.sceneSummary || timeAnchor?.scene_summary || segment.sceneSummary || segment.scene || '';
  const originalSegmentPrompt =
    timeAnchor?.scenePrompt || timeAnchor?.scene_prompt || segment.scenePrompt || segment.prompt || '';
  const effectivePrompt = String(draftPrompt || segment.prompt || originalSegmentPrompt).trim();
  const expandedPrompt = expandResourceMentions(effectivePrompt, characters, backgrounds);
  const segmentAnalysisPromptSections = buildSegmentAnalysisPromptSections({
    segment,
    overallAnalysis,
    analysisOptions: resolvedAnalysisOptions
  });
  const segmentAnalysisPrompt = segmentAnalysisPromptSections.finalPrompt;
  const segmentAnalysisFixedPrompt = segmentAnalysisPromptSections.fixedStructurePrompt;
  const segmentAnalysisStylePrompt = segmentAnalysisPromptSections.stylePrompt;
  const promptOptimizationPrompt = buildPromptOptimizationPrompt({
    prompt: draftPrompt,
    characters,
    backgrounds,
    styleMode: currentStyleMode,
    styleTemplates: currentStyleTemplates
  });
  const segmentDuration = Math.max(0.3, Number(segment.endTime) - Number(segment.startTime));
  const backgroundName =
    segment.backgroundName || timeAnchor?.backgroundName || timeAnchor?.background_name || '未绑定场景';
  const backgroundAction =
    segment.backgroundAction || timeAnchor?.backgroundAction || timeAnchor?.background_action || 'create_new';
  const assembledSegmentUrl = segment.generatedUrl || '';
  const canStartGeneration = Boolean(seedDanceProvider?.ready);
  const seedDanceUnavailableReason = canStartGeneration
    ? ''
    : `Seedance 未就绪：${seedDanceProvider?.reason || '缺少必要配置。'}`;
  const segmentFrameTime = (() => {
    const anchorFrameTime = getNormalizedFrameTime(
      segment.representativeFrameTime ??
        timeAnchor?.representativeFrameTime ??
        timeAnchor?.representative_frame_time
    );

    if (anchorFrameTime === null) {
      return null;
    }

    return Number(clampTime(anchorFrameTime - Number(segment.startTime), 0, segmentDuration).toFixed(2));
  })();
  const segmentFrameNote =
    segment.representativeFrameNote ||
    timeAnchor?.representativeFrameNote ||
    timeAnchor?.representative_frame_note ||
    '该帧用于表示当前片段最典型的画面。';
  const summaryChips = [
    `${segmentShots.length} 镜头`,
    `${segment.characters?.length || 0} 角色`,
    `${segment.scenes?.length || 0} 场景`
  ];

  useEffect(() => {
    setDraftPrompt(segment.prompt ?? originalSegmentPrompt ?? '');
  }, [originalSegmentPrompt, segment.id, segment.prompt]);

  useEffect(() => {
    setUseReferenceVideo(false);
  }, [segment.id]);

  useEffect(() => {
    setShotEditorItems((segment.shots ?? []).map((shot, shotIndex) => buildShotEditorItem(shot, shotIndex)));
  }, [segment.id, segment.shots]);

  useEffect(() => {
    setPersistedShotBaseline((segment.shots ?? []).map((shot, shotIndex) => buildShotEditorItem(shot, shotIndex)));
  }, [segment.id, segmentShotRebuildSignature]);

  const handlePromptChange = (nextValue) => {
    setDraftPrompt(nextValue);
    onPromptChange(segment.id, nextValue);
  };

  const handleOptimizeSegment = (nextPrompt) => {
    const normalizedPrompt = String(nextPrompt ?? '').trim() || effectivePrompt;

    if (normalizedPrompt !== draftPrompt) {
      handlePromptChange(normalizedPrompt);
    }

    return onOptimize(segment.id, normalizedPrompt);
  };

  const referenceVideoToggleLabel = useReferenceVideo ? '参考原片视频：开' : '参考原片视频：关';
  const referenceVideoToggleHint = useReferenceVideo
    ? '当前会把大片段源视频或小镜头源视频一并发送给 Seedance，但人物和场景仍以资源三视图与提示词作为主真值。'
    : '当前不发送原片源视频，主要依赖角色三视图、场景图、资源提示词、典型帧、背景资产视频和参考音频。';

  const handleSegmentStyleModeChange = (nextStyleMode) => {
    onAnalysisOptionsChange({
      styleMode: normalizeStyleMode(nextStyleMode)
    });
  };

  const handleSegmentAnalysisStylePromptChange = (nextPrompt) => {
    onAnalysisOptionsChange({
      styleTemplates: {
        [currentStyleMode]: {
          ...(currentStyleTemplates?.[currentStyleMode] ?? {}),
          segmentAnalysisStylePrompt: String(nextPrompt ?? '')
        }
      }
    });
  };

  const handleRestoreSegmentAnalysisStylePrompt = () => {
    onAnalysisOptionsChange({
      styleTemplates: {
        [currentStyleMode]: {
          ...(currentStyleTemplates?.[currentStyleMode] ?? {}),
          segmentAnalysisStylePrompt: resolveStyleTemplate({
            styleMode: currentStyleMode,
            styleTemplates: null,
            templateKey: 'segmentAnalysisStylePrompt'
          })
        }
      }
    });
  };

  const findPersistedShot = (sourceShotDraft, savedShotDrafts = []) => {
    const sourceShotId = String(sourceShotDraft?.id ?? '').trim();
    const sourceStartTime = Number(sourceShotDraft?.startTime);
    const sourceEndTime = Number(sourceShotDraft?.endTime);
    const sourcePrompt = String(sourceShotDraft?.prompt ?? '').trim();
    const sourceSummary = String(sourceShotDraft?.summary ?? '').trim();
    const sourceShotIndex = Number(sourceShotDraft?.shotIndex ?? -1);

    if (sourceShotId && !sourceShotId.startsWith('temp-shot-')) {
      const exactIdMatch = savedShotDrafts.find((shotDraft) => String(shotDraft.id ?? '').trim() === sourceShotId);

      if (exactIdMatch) {
        return exactIdMatch;
      }
    }

    const exactDraftMatch = savedShotDrafts.find((shotDraft) => {
      return (
        Number(shotDraft.startTime) === sourceStartTime &&
        Number(shotDraft.endTime) === sourceEndTime &&
        String(shotDraft.prompt ?? '').trim() === sourcePrompt &&
        String(shotDraft.summary ?? '').trim() === sourceSummary
      );
    });

    if (exactDraftMatch) {
      return exactDraftMatch;
    }

    const timeMatch = savedShotDrafts.find((shotDraft) => {
      return Number(shotDraft.startTime) === sourceStartTime && Number(shotDraft.endTime) === sourceEndTime;
    });

    if (timeMatch) {
      return timeMatch;
    }

    return savedShotDrafts.find((shotDraft) => Number(shotDraft.shotIndex ?? -1) === sourceShotIndex) ?? null;
  };

  const persistShotDrafts = async ({
    successMessage = '镜头定义已保存，小镜头切片与典型帧已同步重建。',
    failureMessage = '镜头保存失败，请检查时间区间或查看页面提醒。',
    skipMessage = ''
  } = {}) => {
    const requiresPersistence = shouldPersistShotDraftsBeforeGeneration(shotEditorItems, persistedShotBaseline);

    if (!requiresPersistence) {
      if (skipMessage) {
        setEditorBanner(skipMessage);
      }

      const nextShotEditorItems = shotEditorItems.map((shotDraft, shotIndex) => ({
        ...shotDraft,
        shotIndex,
        isNew: false
      }));

      setShotEditorItems(nextShotEditorItems);

      return {
        saveResult: null,
        savedShotDrafts: nextShotEditorItems,
        skippedSave: true
      };
    }

    const savePayload = shotEditorItems.map((shotDraft) => normalizeShotDraftForSave(shotDraft));
    const saveResult = await onSaveShots(segment.id, savePayload);

    if (!saveResult) {
      setEditorBanner(failureMessage);
      return null;
    }

    const savedShots = Array.isArray(saveResult?.analysis?.shots)
      ? saveResult.analysis.shots
      : Array.isArray(saveResult?.shots)
        ? saveResult.shots
        : null;

    if (Array.isArray(savedShots)) {
      const nextShotEditorItems = savedShots.map((shot, shotIndex) => buildShotEditorItem(shot, shotIndex));
      setShotEditorItems(nextShotEditorItems);
      setPersistedShotBaseline(nextShotEditorItems);
      setEditorBanner(successMessage);

      return {
        saveResult,
        savedShotDrafts: nextShotEditorItems
      };
    }

    if (shotEditorItems.some((shotDraft) => String(shotDraft.id ?? '').startsWith('temp-shot-'))) {
      setEditorBanner('镜头已保存，但未拿到最新镜头 ID，请刷新后再试。');
      return null;
    }

    const nextShotEditorItems = shotEditorItems.map((shotDraft, shotIndex) => ({
      ...shotDraft,
      shotIndex,
      isNew: false
    }));
    setShotEditorItems(nextShotEditorItems);
    setPersistedShotBaseline(nextShotEditorItems);
    setEditorBanner(successMessage);

    return {
      saveResult,
      savedShotDrafts: nextShotEditorItems
    };
  };

  const handleBatchGenerate = async ({ persistDrafts = false } = {}) => {
    if (!canStartGeneration) {
      setEditorBanner(seedDanceUnavailableReason);
      return null;
    }

    if (!shotEditorItems.length) {
      setEditorBanner('当前片段还没有小镜头可生成。');
      return null;
    }

    if (!persistDrafts) {
      return onGenerateAllShots(segment.id, null, { useReferenceVideo });
    }

    const persistResult = await persistShotDrafts({
      successMessage: '镜头草稿已自动保存，小镜头切片与典型帧已同步重建，开始批量生成。',
      failureMessage: '镜头保存失败，请修正后再批量生成。',
      skipMessage: '未检测到镜头结构改动，直接按当前编辑器里的提示词批量生成。'
    });

    if (!persistResult) {
      return null;
    }

    return onGenerateAllShots(segment.id, persistResult.savedShotDrafts, { useReferenceVideo });
  };

  const handleDirectGenerate = () => {
    return onGenerate(segment.id, effectivePrompt, { useReferenceVideo });
  };

  const updateShotDraft = (shotId, partialDraft) => {
    setShotEditorItems((currentState) =>
      currentState.map((shotDraft) =>
        shotDraft.id === shotId
          ? {
              ...shotDraft,
              ...partialDraft
            }
          : shotDraft
      )
    );
    setEditorBanner('');
  };

  const updateShotSpeech = (shotId, partialSpeech) => {
    setShotEditorItems((currentState) =>
      currentState.map((shotDraft) =>
        shotDraft.id === shotId
          ? {
              ...shotDraft,
              speech: {
                ...shotDraft.speech,
                ...partialSpeech
              }
            }
          : shotDraft
      )
    );
    setEditorBanner('');
  };

  const updateShotSubtitleLine = (shotId, subtitleId, partialLine) => {
    setShotEditorItems((currentState) =>
      currentState.map((shotDraft) =>
        shotDraft.id === shotId
          ? {
              ...shotDraft,
              speech: {
                ...shotDraft.speech,
                subtitleLines: (shotDraft.speech?.subtitleLines ?? []).map((line) =>
                  line.id === subtitleId
                    ? {
                        ...line,
                        ...partialLine
                      }
                    : line
                )
              }
            }
          : shotDraft
      )
    );
    setEditorBanner('');
  };

  const addShotSubtitleLine = (shotId) => {
    setShotEditorItems((currentState) =>
      currentState.map((shotDraft) => {
        if (shotDraft.id !== shotId) {
          return shotDraft;
        }

        const currentLines = Array.isArray(shotDraft.speech?.subtitleLines) ? shotDraft.speech.subtitleLines : [];
        const lastLine = currentLines[currentLines.length - 1] ?? null;
        const nextStart = lastLine ? Number(lastLine.endTime || 0) : 0;
        const nextEnd = Number((nextStart + 0.5).toFixed(2));

        return {
          ...shotDraft,
          speech: {
            ...shotDraft.speech,
            subtitleLines: [
              ...currentLines,
              normalizeSubtitleLineEditorItem(
                {
                  id: `subtitle_${Date.now()}`,
                  startTime: nextStart,
                  endTime: nextEnd,
                  text: ''
                },
                currentLines.length
              )
            ]
          }
        };
      })
    );
    setEditorBanner('');
  };

  const removeShotSubtitleLine = (shotId, subtitleId) => {
    setShotEditorItems((currentState) =>
      currentState.map((shotDraft) =>
        shotDraft.id === shotId
          ? {
              ...shotDraft,
              speech: {
                ...shotDraft.speech,
                subtitleLines: (shotDraft.speech?.subtitleLines ?? []).filter((line) => line.id !== subtitleId)
              }
            }
          : shotDraft
      )
    );
    setEditorBanner('');
  };

  const handleCopyShotTranscript = async (shotDraft) => {
    const copied = await copyToClipboard(shotDraft?.speech?.transcript ?? '');
    setEditorBanner(copied ? '对白全文已复制到剪贴板。' : '当前环境不支持剪贴板复制。');
  };

  const handleCopyShotSrt = async (shotDraft) => {
    const copied = await copyToClipboard(buildSrtFromSubtitleLines(shotDraft?.speech?.subtitleLines ?? []));
    setEditorBanner(copied ? 'SRT 已复制到剪贴板。' : '当前环境不支持剪贴板复制。');
  };

  const handleAddShot = () => {
    setShotEditorItems((currentState) => [...currentState, buildNewShotEditorItem(segment, currentState)]);
    setEditorBanner('已新增一个待保存的小镜头。');
  };

  const handleSaveShots = async () => {
    await persistShotDrafts();
  };

  const handleOptimizeShot = async (shotId) => {
    const shotDraft = shotEditorItems.find((item) => item.id === shotId);

    if (!shotDraft) {
      return null;
    }

    const optimizedPayload = await onOptimizeShot({
      segmentId: segment.id,
      shotId,
      promptOverride: shotDraft.prompt,
      segmentPromptOverride: effectivePrompt,
      sceneNames: splitNameInput(shotDraft.sceneNamesInput),
      characterNames: splitNameInput(shotDraft.characterNamesInput)
    });

    if (optimizedPayload?.optimized_prompt) {
      updateShotDraft(shotId, {
        prompt: optimizedPayload.optimized_prompt
      });
      setEditorBanner(`镜头 ${String((shotDraft.shotIndex ?? 0) + 1).padStart(2, '0')} 提示词已优化。`);
    }

    return optimizedPayload;
  };

  const handleGenerateShotFromEditor = async (shotId) => {
    const shotDraft = shotEditorItems.find((item) => item.id === shotId);

    if (!shotDraft) {
      return null;
    }

    if (!canStartGeneration) {
      setEditorBanner(seedDanceUnavailableReason);
      return null;
    }

    const nextPrompt = String(shotDraft.prompt ?? '').trim();

    if (!nextPrompt) {
      setEditorBanner('请先完善当前镜头提示词，再执行镜头生成。');
      return null;
    }

    const persistResult = await persistShotDrafts({
      successMessage: '镜头草稿已自动保存，小镜头切片与典型帧已同步重建，正在提交镜头生成。',
      failureMessage: '镜头保存失败，请修正后再生成。',
      skipMessage: '未检测到镜头结构改动，直接按当前编辑器里的提示词生成当前镜头。'
    });

    if (!persistResult) {
      return null;
    }

    const persistedShotDraft = findPersistedShot(shotDraft, persistResult.savedShotDrafts);

    if (!persistedShotDraft?.id) {
      setEditorBanner('镜头已保存，但未能匹配到稳定镜头 ID，请刷新后重试。');
      return null;
    }

    return onGenerateShot(
      segment.id,
      persistedShotDraft.id,
      String(persistedShotDraft.prompt ?? nextPrompt).trim(),
      { useReferenceVideo }
    );
  };

  return (
    <>
      <article className="panel-shell panel-shell-strong segment-card-shell overflow-hidden px-3 py-3 transition md:px-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-bold text-white">
                  片段 {String(segment.segmentIndex + 1).padStart(2, '0')}
                </p>
                <span className="segment-card-mini-pill">
                  {formatDuration(segment.startTime)} - {formatDuration(segment.endTime)}
                </span>
                <span className="segment-card-mini-pill">{formatDuration(segmentDuration)}</span>
                <span className="segment-card-mini-pill">{backgroundName}</span>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {summaryChips.map((item) => (
                  <span key={`${segment.id}-${item}`} className="segment-card-stat-pill">
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge
                status={getBackgroundActionStatus(backgroundAction)}
                label={getBackgroundActionLabel(backgroundAction)}
              />
              <StatusBadge
                status={backgroundAsset?.status || 'idle'}
                label={getBackgroundAssetStatusLabel(backgroundAsset)}
              />
              <StatusBadge
                status={shotGenerationSummary?.status || 'idle'}
                label={getShotAssemblyStatusLabel(shotGenerationSummary)}
              />
              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08]"
                onClick={() => setPromptModalOpen(true)}
              >
                编辑
              </button>
              <button
                type="button"
                aria-pressed={useReferenceVideo}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                  useReferenceVideo
                    ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100 hover:border-emerald-400/35 hover:bg-emerald-500/15'
                    : 'border-white/10 bg-white/[0.04] text-white/75 hover:border-white/20 hover:bg-white/[0.08]'
                }`}
                title={referenceVideoToggleHint}
                onClick={() => setUseReferenceVideo((currentValue) => !currentValue)}
              >
                {referenceVideoToggleLabel}
              </button>
              <button
                type="button"
                className="rounded-full border border-brand-500/20 bg-brand-500/10 px-3 py-1 text-[11px] font-semibold text-brand-100 transition hover:border-brand-500/35 hover:bg-brand-500/15 disabled:opacity-50"
                onClick={() => void handleOptimizeSegment(effectivePrompt)}
                disabled={!effectivePrompt || isOptimizing}
              >
                {isOptimizing ? '优化中...' : '优化大片段提示词'}
              </button>
              <button
                type="button"
                className="rounded-full bg-gradient-to-r from-brand-500 to-accent-500 px-3.5 py-1 text-[11px] font-semibold text-white transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void handleBatchGenerate()}
                disabled={!segmentShots.length || isBatchGenerating || !canStartGeneration}
                title={
                  canStartGeneration
                    ? '按小镜头顺序生成并自动拼回为新的大片段视频。'
                    : `Seedance 未就绪：${seedDanceProvider?.reason || '缺少必要配置。'}`
                }
              >
                {isBatchGenerating ? '拼回中...' : '生成新片段'}
              </button>
            </div>
          </div>

          {!canStartGeneration ? (
            <div className="rounded-[14px] border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-100">
              {seedDanceUnavailableReason} 当前片段与镜头视频生成按钮会保持禁用，配置完成后可立即恢复。
            </div>
          ) : null}

          <div className="rounded-[14px] border border-white/10 bg-black/20 px-3 py-2 text-[12px] leading-5 text-white/68">
            {referenceVideoToggleHint}
          </div>

          <section className="rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">大片段最终提示词</p>
              <span className="segment-card-mini-pill">{segmentShots.length} 个小镜头</span>
            </div>
            <div className="mt-2 text-[12px] leading-6 text-white/82">
              {effectivePrompt ? renderPromptTokenPreview(effectivePrompt) : '等待大片段提示词。'}
            </div>
          </section>

          <section className="rounded-[18px] border border-white/10 bg-black/20 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">小镜头卡列</p>
              <span className="text-[11px] text-white/55">主页仅展示预览、最终提示词和生成结果</span>
            </div>

            <div className="mt-3 grid gap-3">
              {segmentShots.length ? (
                segmentShots.map((shot) => {
                  const shotFrameTime = getNormalizedFrameTime(
                    shot.representativeFrameTime ?? shot.representative_frame_time
                  );
                  const localFrameTime =
                    shotFrameTime !== null
                      ? Number(
                          clampTime(shotFrameTime - Number(segment.startTime), 0, segmentDuration).toFixed(2)
                        )
                      : null;
                  const isShotGenerating = generatingShotKeys.includes(`${segment.id}:${shot.id}`);

                  return (
                    <article
                      key={`${segment.id}-${shot.id}`}
                      className="grid gap-3 rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3 lg:grid-cols-[220px_minmax(0,1fr)_220px]"
                    >
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">
                            镜头 {String((shot.shotIndex ?? 0) + 1).padStart(2, '0')}
                          </p>
                          <span className="segment-card-stat-pill">
                            {formatDuration(shot.startTime ?? 0)} - {formatDuration(shot.endTime ?? 0)}
                          </span>
                        </div>
                        <div className="space-y-3">
                          <ShotSourcePreview
                            sourceFileUrl={shot.sourceFileUrl}
                            fallbackLabel="当前镜头源切片缺失，保存镜头或重新切分后会重建。"
                          />
                          <ShotRepresentativeFramePreview
                            representativeFrameImageUrl={shot.representativeFrameImageUrl}
                            representativeFrameNote={shot.representativeFrameNote}
                            fallbackVideoUrl={segment.sourceUrl}
                            fallbackTimeSeconds={localFrameTime}
                            originalTimeSeconds={shotFrameTime}
                            label={`镜头 ${String((shot.shotIndex ?? 0) + 1).padStart(2, '0')} 典型帧`}
                          />
                        </div>
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge
                            status={shot.latestGenerationTask?.status || 'idle'}
                            label={
                              shot.latestGenerationTask?.status === 'completed'
                                ? '镜头已生成'
                                : shot.latestGenerationTask?.status === 'failed'
                                  ? '镜头失败'
                                  : isShotGenerating
                                    ? '镜头生成中'
                                    : '待生成'
                            }
                          />
                          <button
                            type="button"
                            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08] disabled:opacity-50"
                            onClick={() => void onGenerateShot(segment.id, shot.id, shot.prompt, { useReferenceVideo })}
                            disabled={isShotGenerating || !canStartGeneration}
                          >
                            {isShotGenerating ? '生成中...' : '生成镜头'}
                          </button>
                        </div>

                        {shouldShowGenerationProgress(shot.latestGenerationTask) ? (
                          <div className="mt-3">
                            <ProgressBar
                              value={shot.latestGenerationTask?.progress ?? 0}
                              status={shot.latestGenerationTask?.status ?? 'pending'}
                              label={`镜头任务 · ${getGenerationTaskStatusLabel(shot.latestGenerationTask, '镜头待生成')}`}
                              startedAt={shot.latestGenerationTask?.created_at || ''}
                              compact
                            />
                            <TaskReferenceDebugPanel task={shot.latestGenerationTask} />
                          </div>
                        ) : null}

                        <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">
                          当前最终提示词
                        </p>
                        <div className="mt-2 text-[12px] leading-6 text-white/82">
                          {shot.prompt ? renderPromptTokenPreview(shot.prompt) : '等待镜头提示词。'}
                        </div>
                      </div>

                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">
                          新小镜头预览
                        </p>
                        {shot.generatedUrl ? (
                          <video className="segment-workbench-video mt-2" src={shot.generatedUrl} controls preload="metadata" />
                        ) : (
                          <div className="preview-placeholder segment-workbench-empty mt-2 min-h-[170px]">
                            <div className="preview-orb" />
                            <p className="text-sm font-semibold text-white">待生成镜头</p>
                          </div>
                        )}
                        {Array.isArray(shot.speech?.subtitleLines) && shot.speech.subtitleLines.length ? (
                          <div className="mt-3 rounded-[12px] border border-white/10 bg-black/20 px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
                              字幕预览
                            </p>
                            <p className="mt-1 text-[12px] leading-5 text-white/72">
                              {shot.speech.subtitleLines.map((line) => line.text).join(' / ')}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="rounded-[16px] border border-dashed border-white/10 bg-black/10 px-4 py-5 text-center text-[12px] text-white/60">
                  当前大片段还没有小镜头定义，请进入编辑弹窗新增并保存镜头。
                </div>
              )}
            </div>
          </section>

          <section className="rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">新片段预览</p>
              {assembledSegmentUrl ? <StatusBadge status="completed" label="已拼回" /> : <StatusBadge status="idle" label="待生成" />}
            </div>

            {shouldShowGenerationProgress(segment.latestGenerationTask) ? (
              <div className="mt-2">
                <ProgressBar
                  value={segment.latestGenerationTask?.progress ?? 0}
                  status={segment.latestGenerationTask?.status ?? 'pending'}
                  label={`大片段任务 · ${getGenerationTaskStatusLabel(segment.latestGenerationTask, '大片段待生成')}`}
                  startedAt={segment.latestGenerationTask?.created_at || ''}
                />
                <TaskReferenceDebugPanel task={segment.latestGenerationTask} />
              </div>
            ) : null}

            {shotGenerationSummary ? (
              <div className="mt-2">
                <ProgressBar
                  value={shotGenerationSummary.progress ?? 0}
                  status={shotGenerationSummary.status ?? 'pending'}
                  label={`镜头进度 ${shotGenerationSummary.completed_shot_count || 0}/${shotGenerationSummary.total_shot_count || 0}`}
                />
              </div>
            ) : null}

            {assembledSegmentUrl ? (
              <video className="segment-workbench-video mt-3" src={assembledSegmentUrl} controls preload="metadata" />
            ) : (
              <div className="preview-placeholder segment-workbench-empty mt-3 min-h-[190px]">
                <div className="preview-orb" />
                <p className="text-sm font-semibold text-white">待拼回大片段</p>
                <p className="mt-2 max-w-[260px] text-center text-[11px] leading-5 text-white/60">
                  点击“生成新片段”后，系统会顺序生成全部小镜头并自动拼回这里。
                </p>
              </div>
            )}
          </section>
        </div>
      </article>

      <ModalSheet
        open={promptModalOpen}
        onClose={() => setPromptModalOpen(false)}
        title={`片段 ${String(segment.segmentIndex + 1).padStart(2, '0')} · 编辑工作台`}
        description="主页只保留结果预览；这里集中处理大片段提示词、小镜头优化、新增镜头与保存。"
        size="xl"
      >
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <VideoFramePreview
              videoUrl={segment.sourceUrl}
              timeSeconds={segmentFrameTime}
              originalTimeSeconds={segment.representativeFrameTime ?? timeAnchor?.representativeFrameTime ?? null}
              label="大片段典型帧"
              note={segmentFrameNote}
              requestedTimeLabel="片段时间"
            />

            <div className="space-y-3">
              <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-3.5 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">整片分析原始大片段内容</p>
                <p className="mt-2 text-[13px] leading-6 text-white/70">
                  {originalSegmentSummary || '等待整片分析返回片段解释。'}
                </p>
                <div className="mt-3 rounded-[16px] border border-white/10 bg-black/20 px-3 py-2.5 text-[12px] leading-6 text-white/80">
                  {originalSegmentPrompt ? renderPromptTokenPreview(originalSegmentPrompt) : '等待整片分析返回原始片段提示词。'}
                </div>
              </div>

              <PromptEditor
                value={effectivePrompt}
                onChange={handlePromptChange}
                onAnalyze={() => onAnalyze(segment.id)}
                onOptimize={handleOptimizeSegment}
                isAnalyzing={isAnalyzing}
                isOptimizing={isOptimizing}
                disabled={isBatchGenerating}
                highlightedPrompt={segment.highlightedPrompt}
                description="大片段提示词可继续优化，并为镜头级优化提供叙事上下文。"
                placeholder="在这里编辑大片段提示词，使用 @角色名 和 #场景名 来保持资源一致。"
                analyzeLabel="片段分析"
                optimizeLabel="优化大片段提示词"
                mentionSummaryLabel="资源标签"
              />

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  aria-pressed={useReferenceVideo}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    useReferenceVideo
                      ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100 hover:border-emerald-400/35 hover:bg-emerald-500/15'
                      : 'border-white/10 bg-white/[0.04] text-white/75 hover:border-white/20 hover:bg-white/[0.08]'
                  }`}
                  onClick={() => setUseReferenceVideo((currentValue) => !currentValue)}
                >
                  {referenceVideoToggleLabel}
                </button>
                <button
                  type="button"
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08] disabled:opacity-50"
                  onClick={() => void handleDirectGenerate()}
                  disabled={!effectivePrompt || isGenerating || !canStartGeneration}
                  title={
                    canStartGeneration
                      ? '保留原有能力：直接按大片段提示词生成整段。'
                      : `Seedance 未就绪：${seedDanceProvider?.reason || '缺少必要配置。'}`
                  }
                >
                  {isGenerating ? '生成中...' : '直接生成整段'}
                </button>
              </div>
            </div>
          </div>

          <PromptPreview
            title="大片段提示词优化调用词"
            description="点击“优化大片段提示词”时，后端会把当前大片段提示词、角色设定和场景资源库一起发送给优化模型。"
            prompt={promptOptimizationPrompt}
            modelLabel="Gemini"
          />
          <PromptPreview
            title="角色与场景展开后的最终生成提示词"
            description="真正发给生成模型前，后端会把 @角色名 与 #场景名 替换成资源库中的真实提示词。"
            prompt={expandedPrompt}
            modelLabel="SeedDance"
          />
          <div className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">片段理解风格段</p>
                <p className="mt-1 text-xs leading-5 text-white/55">
                  固定 JSON 结构和字段要求保持只读；这里只编辑片段理解的风格段。当前风格为 {currentStyleLabel}。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label="片段理解风格模式"
                  className="rounded-full border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  value={currentStyleMode}
                  onChange={(event) => handleSegmentStyleModeChange(event.target.value)}
                >
                  {STYLE_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08]"
                  onClick={handleRestoreSegmentAnalysisStylePrompt}
                >
                  恢复预设
                </button>
              </div>
            </div>

            <textarea
              aria-label="片段理解风格提示编辑器"
              className="mt-4 min-h-[140px] w-full rounded-[18px] border border-white/10 bg-black/[0.35] px-4 py-4 text-sm leading-6 text-white outline-none transition focus:border-brand-500/40 focus:ring-2 focus:ring-brand-500/20"
              value={segmentAnalysisStylePrompt}
              onChange={(event) => handleSegmentAnalysisStylePromptChange(event.target.value)}
            />
          </div>

          <PromptPreview
            title="片段理解固定结构段"
            description="点击“片段分析”时，这一段会原样发送给 Gemini，用于约束片段 JSON 结构、场景绑定和输出规则。"
            prompt={segmentAnalysisFixedPrompt}
            modelLabel="Gemini"
          />
          <PromptPreview
            title="片段理解提示词"
            description="这是最终拼装后的片段理解提示词，会在点击“片段分析”时发送给 Gemini。"
            prompt={segmentAnalysisPrompt}
            modelLabel="Gemini"
          />

          <section className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">Shot Workbench</p>
                <h3 className="mt-1 text-sm font-semibold text-white">小镜头编辑与生成</h3>
                <p className="mt-1 text-[12px] leading-5 text-white/60">
                  可新增镜头、修改绝对秒数、优化镜头提示词；保存时会同步重建小镜头切片和典型帧。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  status={shotGenerationSummary?.status || 'idle'}
                  label={getShotAssemblyStatusLabel(shotGenerationSummary)}
                />
                <button
                  type="button"
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08]"
                  onClick={handleAddShot}
                >
                  新增镜头
                </button>
                <button
                  type="button"
                  className="rounded-full border border-brand-500/20 bg-brand-500/10 px-3 py-1.5 text-[11px] font-semibold text-brand-100 transition hover:border-brand-500/35 hover:bg-brand-500/15 disabled:opacity-50"
                  onClick={() => void handleSaveShots()}
                  disabled={isSavingShots}
                >
                  {isSavingShots ? '保存并重建中...' : '保存镜头'}
                </button>
                <button
                  type="button"
                  className="rounded-full bg-gradient-to-r from-brand-500 to-accent-500 px-3.5 py-1.5 text-[11px] font-semibold text-white transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void handleBatchGenerate({ persistDrafts: true })}
                  disabled={!shotEditorItems.length || isBatchGenerating || isSavingShots || !canStartGeneration}
                >
                  {isBatchGenerating ? '镜头批处理中...' : '一键生成全部镜头'}
                </button>
              </div>
            </div>

            {!canStartGeneration ? (
              <div className="mt-3 rounded-[14px] border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-100">
                {seedDanceUnavailableReason} 编辑区会保留保存入口，但镜头生成需要 Seedance 就绪后才能执行。
              </div>
            ) : null}

            {editorBanner ? (
              <div className="mt-3 rounded-[14px] border border-white/10 bg-black/20 px-3 py-2 text-[12px] leading-5 text-white/72">
                {editorBanner}
              </div>
            ) : null}

            <div className="mt-4 space-y-3">
              {shotEditorItems.map((shotDraft, shotIndex) => {
                const isShotGenerating = generatingShotKeys.includes(`${segment.id}:${shotDraft.id}`);
                const isShotOptimizing = optimizingShotKeys.includes(`${segment.id}:${shotDraft.id}`);
                const localStartTime = Number(
                  clampTime(Number(shotDraft.startTime || 0) - Number(segment.startTime), 0, segmentDuration).toFixed(2)
                );
                const localEndTime = Number(
                  clampTime(Number(shotDraft.endTime || 0) - Number(segment.startTime), 0, segmentDuration).toFixed(2)
                );
                const shotDuration = Number(Math.max(0.3, localEndTime - localStartTime).toFixed(2));
                const shotFrameTime =
                  getNormalizedFrameTime(shotDraft.representativeFrameTime) ??
                  getNormalizedFrameTime(
                    (Number(shotDraft.startTime) + Number(shotDraft.endTime)) / 2
                  );
                const localFrameTime =
                  shotFrameTime !== null
                    ? Number(clampTime(shotFrameTime - Number(segment.startTime), 0, segmentDuration).toFixed(2))
                    : null;

                return (
                  <article
                    key={`${segment.id}-${shotDraft.id}`}
                    className="rounded-[18px] border border-white/10 bg-black/20 px-3.5 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[13px] font-semibold text-white">
                          镜头 {String(shotIndex + 1).padStart(2, '0')}
                        </p>
                        <p className="mt-1 text-[11px] text-white/50">
                          整片时间 {shotDraft.startTime || '--'} - {shotDraft.endTime || '--'} 秒
                        </p>
                        <p className="mt-1 text-[11px] text-white/45">
                          片段局部 {localStartTime.toFixed(2)} - {localEndTime.toFixed(2)} 秒 · 时长{' '}
                          {shotDuration.toFixed(2)} 秒
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          status={shotDraft.latestGenerationTask?.status || 'idle'}
                          label={
                            shotDraft.latestGenerationTask?.status === 'completed'
                              ? '镜头已生成'
                              : shotDraft.latestGenerationTask?.status === 'failed'
                                ? '镜头失败'
                                : shotDraft.isNew
                                  ? '待保存'
                                  : '待生成'
                          }
                        />
                        <button
                          type="button"
                          className="rounded-full border border-brand-500/20 bg-brand-500/10 px-3 py-1 text-[11px] font-semibold text-brand-100 transition hover:border-brand-500/35 hover:bg-brand-500/15 disabled:opacity-50"
                          onClick={() => void handleOptimizeShot(shotDraft.id)}
                          disabled={isShotOptimizing || !String(shotDraft.prompt ?? '').trim()}
                        >
                          {isShotOptimizing ? '优化中...' : '优化镜头提示词'}
                        </button>
                        <button
                          type="button"
                          className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08] disabled:opacity-50"
                          onClick={() => void handleGenerateShotFromEditor(shotDraft.id)}
                          disabled={isShotGenerating || isSavingShots || !canStartGeneration}
                        >
                          {isShotGenerating ? '生成中...' : '生成当前镜头'}
                        </button>
                      </div>
                    </div>

                    {shouldShowGenerationProgress(shotDraft.latestGenerationTask) ? (
                      <div className="mt-3">
                        <ProgressBar
                          value={shotDraft.latestGenerationTask?.progress ?? 0}
                          status={shotDraft.latestGenerationTask?.status ?? 'pending'}
                          label={`镜头任务 · ${getGenerationTaskStatusLabel(
                            shotDraft.latestGenerationTask,
                            shotDraft.isNew ? '待保存后生成' : '镜头待生成'
                          )}`}
                          startedAt={shotDraft.latestGenerationTask?.created_at || ''}
                          compact
                        />
                        <TaskReferenceDebugPanel task={shotDraft.latestGenerationTask} />
                      </div>
                    ) : null}

                    <div className="mt-3 grid gap-3 xl:grid-cols-[260px_minmax(0,1fr)_260px]">
                      <div className="space-y-3">
                        <ShotSourcePreview
                          sourceFileUrl={shotDraft.sourceFileUrl}
                          fallbackLabel={
                            shotDraft.isNew
                              ? '新增镜头保存后会自动切出独立源镜头。'
                              : '当前镜头源切片缺失，保存镜头后会自动重建。'
                          }
                        />
                        <ShotRepresentativeFramePreview
                          representativeFrameImageUrl={shotDraft.representativeFrameImageUrl}
                          representativeFrameNote={shotDraft.representativeFrameNote}
                          fallbackVideoUrl={segment.sourceUrl}
                          fallbackTimeSeconds={localFrameTime}
                          originalTimeSeconds={shotFrameTime}
                          label={`镜头 ${String(shotIndex + 1).padStart(2, '0')} 典型帧`}
                        />
                      </div>

                      <div className="space-y-3 rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3">
                        <div className="grid gap-3 md:grid-cols-3">
                          <label className="space-y-1 text-[11px] text-white/55">
                            <span>开始秒数</span>
                            <input
                              type="number"
                              step="0.1"
                              min={segment.startTime}
                              max={segment.endTime}
                              value={shotDraft.startTime}
                              onChange={(event) => updateShotDraft(shotDraft.id, { startTime: event.target.value })}
                              className="w-full rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] text-white outline-none"
                            />
                          </label>
                          <label className="space-y-1 text-[11px] text-white/55">
                            <span>结束秒数</span>
                            <input
                              type="number"
                              step="0.1"
                              min={segment.startTime}
                              max={segment.endTime}
                              value={shotDraft.endTime}
                              onChange={(event) => updateShotDraft(shotDraft.id, { endTime: event.target.value })}
                              className="w-full rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] text-white outline-none"
                            />
                          </label>
                          <label className="space-y-1 text-[11px] text-white/55">
                            <span>典型帧秒数</span>
                            <input
                              type="number"
                              step="0.1"
                              min={segment.startTime}
                              max={segment.endTime}
                              value={shotDraft.representativeFrameTime}
                              onChange={(event) =>
                                updateShotDraft(shotDraft.id, {
                                  representativeFrameTime: event.target.value
                                })
                              }
                              className="w-full rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] text-white outline-none"
                            />
                          </label>
                        </div>

                        <label className="block space-y-1 text-[11px] text-white/55">
                          <span>镜头摘要</span>
                          <input
                            type="text"
                            value={shotDraft.summary}
                            onChange={(event) => updateShotDraft(shotDraft.id, { summary: event.target.value })}
                            className="w-full rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] text-white outline-none"
                            placeholder="描述当前小镜头发生了什么"
                          />
                        </label>

                        <label className="block space-y-1 text-[11px] text-white/55">
                          <span>当前最终提示词</span>
                          <textarea
                            value={shotDraft.prompt}
                            onChange={(event) => {
                              updateShotDraft(shotDraft.id, { prompt: event.target.value });
                              if (!shotDraft.isNew) {
                                onShotPromptChange(segment.id, shotDraft.id, event.target.value);
                              }
                            }}
                            className="min-h-[120px] w-full rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] leading-6 text-white outline-none"
                            placeholder="编辑当前镜头最终提示词，支持 @角色名 和 #场景名"
                          />
                        </label>

                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="space-y-1 text-[11px] text-white/55">
                            <span>场景标签</span>
                            <input
                              type="text"
                              value={shotDraft.sceneNamesInput}
                              onChange={(event) => updateShotDraft(shotDraft.id, { sceneNamesInput: event.target.value })}
                              className="w-full rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] text-white outline-none"
                              placeholder="多个场景用逗号分隔"
                            />
                          </label>
                          <label className="space-y-1 text-[11px] text-white/55">
                            <span>角色标签</span>
                            <input
                              type="text"
                              value={shotDraft.characterNamesInput}
                              onChange={(event) =>
                                updateShotDraft(shotDraft.id, { characterNamesInput: event.target.value })
                              }
                              className="w-full rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] text-white outline-none"
                              placeholder="多个角色用逗号分隔"
                            />
                          </label>
                        </div>

                        <label className="block space-y-1 text-[11px] text-white/55">
                          <span>典型帧说明</span>
                          <input
                            type="text"
                            value={shotDraft.representativeFrameNote}
                            onChange={(event) =>
                              updateShotDraft(shotDraft.id, {
                                representativeFrameNote: event.target.value
                              })
                            }
                            className="w-full rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] text-white outline-none"
                            placeholder="说明为什么这个时间点最能代表当前镜头"
                          />
                        </label>

                        <section className="rounded-[14px] border border-white/10 bg-black/20 px-3 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
                                台词 / 字幕
                              </p>
                              <p className="mt-1 text-[12px] leading-5 text-white/60">
                                这里的文本主要用于查看、复制和导出。当前口型真值仍默认优先使用原镜头参考音频。
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08]"
                                onClick={() => void handleCopyShotTranscript(shotDraft)}
                              >
                                复制全文
                              </button>
                              <button
                                type="button"
                                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08]"
                                onClick={() => void handleCopyShotSrt(shotDraft)}
                              >
                                复制 SRT
                              </button>
                              {shotDraft.speech?.subtitleFileUrl ? (
                                <a
                                  href={shotDraft.speech.subtitleFileUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-full border border-brand-500/20 bg-brand-500/10 px-3 py-1 text-[11px] font-semibold text-brand-100 transition hover:border-brand-500/35 hover:bg-brand-500/15"
                                >
                                  下载 SRT
                                </a>
                              ) : null}
                            </div>
                          </div>

                          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                            <div className="space-y-3">
                              <label className="block space-y-1 text-[11px] text-white/55">
                                <span>对白全文</span>
                                <textarea
                                  value={shotDraft.speech?.transcript ?? ''}
                                  onChange={(event) =>
                                    updateShotSpeech(shotDraft.id, {
                                      transcript: event.target.value,
                                      hasDialogue: Boolean(event.target.value.trim()) || Boolean(shotDraft.speech?.subtitleLines?.length),
                                      sourceOfTruth: 'edited_text'
                                    })
                                  }
                                  className="min-h-[96px] w-full rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] leading-6 text-white outline-none"
                                  placeholder="这里显示当前镜头对白全文，可复制、校对和微调。"
                                />
                              </label>

                              <label className="block space-y-1 text-[11px] text-white/55">
                                <span>说话方式</span>
                                <input
                                  type="text"
                                  value={shotDraft.speech?.speechStyle ?? ''}
                                  onChange={(event) =>
                                    updateShotSpeech(shotDraft.id, {
                                      speechStyle: event.target.value,
                                      sourceOfTruth: 'edited_text'
                                    })
                                  }
                                  className="w-full rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] text-white outline-none"
                                  placeholder="语速、停顿、情绪、语气、说话力度、口型明显程度"
                                />
                              </label>

                              <label className="flex items-center gap-2 text-[12px] text-white/72">
                                <input
                                  type="checkbox"
                                  checked={Boolean(shotDraft.speech?.hasDialogue)}
                                  onChange={(event) =>
                                    updateShotSpeech(shotDraft.id, {
                                      hasDialogue: event.target.checked,
                                      sourceOfTruth: 'edited_text'
                                    })
                                  }
                                  className="h-4 w-4 accent-emerald-400"
                                />
                                当前镜头包含对白 / 口型
                              </label>

                              <div className="rounded-[12px] border border-white/10 bg-white/[0.04] px-3 py-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
                                    字幕列表
                                  </p>
                                  <button
                                    type="button"
                                    className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08]"
                                    onClick={() => addShotSubtitleLine(shotDraft.id)}
                                  >
                                    新增字幕行
                                  </button>
                                </div>

                                <div className="mt-3 space-y-2">
                                  {(shotDraft.speech?.subtitleLines ?? []).length ? (
                                    (shotDraft.speech?.subtitleLines ?? []).map((line, lineIndex) => (
                                      <div
                                        key={`${shotDraft.id}-${line.id}`}
                                        className="grid gap-2 rounded-[12px] border border-white/10 bg-black/20 px-3 py-3 md:grid-cols-[90px_90px_minmax(0,1fr)_72px]"
                                      >
                                        <input
                                          type="number"
                                          step="0.1"
                                          min="0"
                                          value={line.startTime}
                                          onChange={(event) =>
                                            updateShotSubtitleLine(shotDraft.id, line.id, {
                                              startTime: event.target.value
                                            })
                                          }
                                          className="rounded-[10px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] text-white outline-none"
                                          placeholder="开始"
                                        />
                                        <input
                                          type="number"
                                          step="0.1"
                                          min="0"
                                          value={line.endTime}
                                          onChange={(event) =>
                                            updateShotSubtitleLine(shotDraft.id, line.id, {
                                              endTime: event.target.value
                                            })
                                          }
                                          className="rounded-[10px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] text-white outline-none"
                                          placeholder="结束"
                                        />
                                        <input
                                          type="text"
                                          value={line.text}
                                          onChange={(event) =>
                                            updateShotSubtitleLine(shotDraft.id, line.id, {
                                              text: event.target.value
                                            })
                                          }
                                          className="rounded-[10px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] text-white outline-none"
                                          placeholder={`字幕 ${lineIndex + 1}`}
                                        />
                                        <button
                                          type="button"
                                          className="rounded-[10px] border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[11px] font-semibold text-rose-100 transition hover:border-rose-500/35 hover:bg-rose-500/15"
                                          onClick={() => removeShotSubtitleLine(shotDraft.id, line.id)}
                                        >
                                          删除
                                        </button>
                                      </div>
                                    ))
                                  ) : (
                                    <div className="rounded-[12px] border border-dashed border-white/10 bg-black/10 px-3 py-3 text-[12px] text-white/60">
                                      当前镜头还没有字幕行。若整片理解已抽到字幕，会自动显示在这里；也可以手动补一行。
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="space-y-3">
                              <div className="rounded-[12px] border border-white/10 bg-white/[0.04] px-3 py-3">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
                                  参考音频
                                </p>
                                {shotDraft.sourceAudioFileUrl ? (
                                  <audio className="mt-3 w-full" src={shotDraft.sourceAudioFileUrl} controls preload="metadata" />
                                ) : (
                                  <p className="mt-3 text-[12px] leading-5 text-white/60">
                                    当前镜头暂无持久化参考音频。保存并重建后会重新尝试抽取。
                                  </p>
                                )}
                              </div>

                              <div className="rounded-[12px] border border-white/10 bg-white/[0.04] px-3 py-3">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
                                  字幕状态
                                </p>
                                <p className="mt-2 text-[12px] leading-5 text-white/72">
                                  提取状态：{shotDraft.speech?.extractionStatus || 'idle'}
                                </p>
                                {shotDraft.speech?.sourceOfTruth ? (
                                  <p className="mt-1 text-[12px] leading-5 text-white/60">
                                    当前文本来源：{shotDraft.speech.sourceOfTruth}
                                  </p>
                                ) : null}
                                {shotDraft.speech?.extractionError ? (
                                  <p className="mt-2 text-[12px] leading-5 text-amber-100">
                                    {shotDraft.speech.extractionError}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </section>

                        <section className="rounded-[14px] border border-white/10 bg-black/20 px-3 py-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
                            当前角色状态
                          </p>
                          <div className="mt-3 space-y-2">
                            {(shotDraft.characterStateRefs ?? []).length ? (
                              shotDraft.characterStateRefs.map((stateRef, stateRefIndex) => (
                                <div
                                  key={`${shotDraft.id}-${stateRef.characterName}-${stateRef.stateId || stateRefIndex}`}
                                  className="rounded-[12px] border border-white/10 bg-white/[0.04] px-3 py-3"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-sm font-semibold text-white">
                                      @{stateRef.characterName} {stateRef.stateName ? `· ${stateRef.stateName}` : ''}
                                    </p>
                                    {stateRef.representativeFrameImageUrl ? (
                                      <img
                                        src={stateRef.representativeFrameImageUrl}
                                        alt={`${stateRef.characterName} 状态参考`}
                                        className="h-12 w-12 rounded-[10px] border border-white/10 object-cover"
                                      />
                                    ) : null}
                                  </div>
                                  {stateRef.summary ? (
                                    <p className="mt-2 text-[12px] leading-5 text-white/72">{stateRef.summary}</p>
                                  ) : null}
                                  {stateRef.continuityPrompt ? (
                                    <p className="mt-2 text-[12px] leading-5 text-white/60">
                                      连续性约束：{stateRef.continuityPrompt}
                                    </p>
                                  ) : null}
                                </div>
                              ))
                            ) : (
                              <div className="rounded-[12px] border border-dashed border-white/10 bg-black/10 px-3 py-3 text-[12px] text-white/60">
                                当前镜头没有绑定角色状态引用。保存镜头或保存角色状态时间线后会自动重新计算。
                              </div>
                            )}
                          </div>
                        </section>
                      </div>

                      <div className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">新镜头预览</p>
                        {shotDraft.generatedUrl ? (
                          <video className="segment-workbench-video mt-2" src={shotDraft.generatedUrl} controls preload="metadata" />
                        ) : (
                          <div className="preview-placeholder segment-workbench-empty mt-2 min-h-[180px]">
                            <div className="preview-orb" />
                            <p className="text-sm font-semibold text-white">
                              {shotDraft.isNew ? '先保存后生成' : '待生成镜头'}
                            </p>
                          </div>
                        )}
                        <div className="mt-3 text-[12px] leading-6 text-white/78">
                          {shotDraft.prompt ? renderPromptTokenPreview(shotDraft.prompt) : '等待镜头提示词。'}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </ModalSheet>
    </>
  );
};

SegmentCard.propTypes = {
  segment: PropTypes.shape({
    id: PropTypes.number.isRequired,
    segmentIndex: PropTypes.number.isRequired,
    startTime: PropTypes.number.isRequired,
    endTime: PropTypes.number.isRequired,
    sourceUrl: PropTypes.string.isRequired,
    generatedUrl: PropTypes.string,
    scene: PropTypes.string,
    action: PropTypes.string,
    prompt: PropTypes.string,
    sceneSummary: PropTypes.string,
    scenePrompt: PropTypes.string,
    scenes: PropTypes.arrayOf(PropTypes.string),
    backgroundId: PropTypes.string,
    backgroundAction: PropTypes.string,
    backgroundName: PropTypes.string,
    backgroundPrompt: PropTypes.string,
    representativeFrameTime: PropTypes.number,
    representativeFrameNote: PropTypes.string,
    characters: PropTypes.arrayOf(PropTypes.string),
    shots: PropTypes.arrayOf(
      PropTypes.shape({
        id: PropTypes.string,
        shotIndex: PropTypes.number,
        startTime: PropTypes.number,
        endTime: PropTypes.number,
        localStartTime: PropTypes.number,
        localEndTime: PropTypes.number,
        durationSeconds: PropTypes.number,
        summary: PropTypes.string,
        prompt: PropTypes.string,
        sceneNames: PropTypes.arrayOf(PropTypes.string),
        characterNames: PropTypes.arrayOf(PropTypes.string),
        representativeFrameTime: PropTypes.number,
        representativeFrameNote: PropTypes.string,
        sourceFilePath: PropTypes.string,
        sourceFileUrl: PropTypes.string,
        sourceLocalStartTime: PropTypes.number,
        sourceLocalEndTime: PropTypes.number,
        representativeFrameImagePath: PropTypes.string,
        representativeFrameImageUrl: PropTypes.string,
        representativeFrameActualTime: PropTypes.number,
        sourceAudioFilePath: PropTypes.string,
        sourceAudioFileUrl: PropTypes.string,
        speech: PropTypes.shape({
          transcript: PropTypes.string,
          subtitleLines: PropTypes.arrayOf(
            PropTypes.shape({
              id: PropTypes.string,
              startTime: PropTypes.number,
              endTime: PropTypes.number,
              text: PropTypes.string
            })
          ),
          speechStyle: PropTypes.string,
          hasDialogue: PropTypes.bool,
          extractionStatus: PropTypes.string,
          extractionError: PropTypes.string,
          subtitleFilePath: PropTypes.string,
          subtitleFileUrl: PropTypes.string,
          sourceOfTruth: PropTypes.string
        }),
        characterStateRefs: PropTypes.arrayOf(
          PropTypes.shape({
            characterName: PropTypes.string,
            stateId: PropTypes.string,
            stateName: PropTypes.string,
            summary: PropTypes.string,
            continuityPrompt: PropTypes.string,
            representativeFrameTime: PropTypes.number,
            representativeFrameImagePath: PropTypes.string,
            representativeFrameImageUrl: PropTypes.string
          })
        ),
        generatedUrl: PropTypes.string,
        latestGenerationTask: PropTypes.object,
        latestCompletedGenerationTask: PropTypes.object
      })
    ),
    shotGenerationSummary: PropTypes.object,
    latestShotAssemblyTask: PropTypes.object,
    highlightedPrompt: PropTypes.string,
    latestGenerationTask: PropTypes.shape({
      status: PropTypes.string,
      progress: PropTypes.number,
      prompt: PropTypes.string,
      optimizedPrompt: PropTypes.string,
      engine: PropTypes.string,
      is_mock: PropTypes.bool,
      use_reference_video: PropTypes.bool,
      remote_task_id: PropTypes.string,
      fallback_reason: PropTypes.string,
      provider_error: PropTypes.string,
      source: PropTypes.string,
      sent_reference_images: PropTypes.arrayOf(PropTypes.object),
      sent_reference_videos: PropTypes.arrayOf(PropTypes.object),
      sent_reference_audios: PropTypes.arrayOf(PropTypes.object)
    })
  }).isRequired,
  overallAnalysis: PropTypes.shape({
    plot: PropTypes.string,
    characters: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.string, PropTypes.object])),
    backgrounds: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.string, PropTypes.object]))
  }),
  analysisOptions: PropTypes.shape({
    extractSubtitles: PropTypes.bool,
    parseAudio: PropTypes.bool,
    styleMode: PropTypes.string,
    styleTemplates: PropTypes.object
  }),
  timeAnchor: PropTypes.shape({
    sceneSummary: PropTypes.string,
    scenePrompt: PropTypes.string,
    scenes: PropTypes.arrayOf(PropTypes.string),
    backgroundId: PropTypes.string,
    backgroundAction: PropTypes.string,
    backgroundName: PropTypes.string,
    representativeFrameTime: PropTypes.number,
    representativeFrameNote: PropTypes.string
  }),
  backgroundAsset: PropTypes.shape({
    backgroundId: PropTypes.string,
    status: PropTypes.string,
    assetUrl: PropTypes.string,
    errorMessage: PropTypes.string
  }),
  expanded: PropTypes.bool,
  onToggle: PropTypes.func,
  onAnalysisOptionsChange: PropTypes.func,
  onPromptChange: PropTypes.func,
  onShotPromptChange: PropTypes.func,
  onAnalyze: PropTypes.func,
  onOptimize: PropTypes.func,
  onOptimizeShot: PropTypes.func,
  onGenerate: PropTypes.func,
  onGenerateShot: PropTypes.func,
  onGenerateAllShots: PropTypes.func,
  onSaveShots: PropTypes.func,
  isAnalyzing: PropTypes.bool,
  isOptimizing: PropTypes.bool,
  isGenerating: PropTypes.bool,
  generatingShotKeys: PropTypes.arrayOf(PropTypes.string),
  isBatchGenerating: PropTypes.bool,
  optimizingShotKeys: PropTypes.arrayOf(PropTypes.string),
  isSavingShots: PropTypes.bool
};

export default SegmentCard;
