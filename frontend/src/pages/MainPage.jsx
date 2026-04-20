import { useState } from 'react';

import AnalysisDisplay from '../components/AnalysisDisplay.jsx';
import ModalSheet from '../components/ModalSheet.jsx';
import SegmentCard from '../components/SegmentCard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import UploadArea from '../components/UploadArea.jsx';
import VideoMerge from '../components/VideoMerge.jsx';
import { useAnalysis, useAppHealth, useGeneration, useSegments, useVideoUpload } from '../hooks/index.js';
import { formatDateTime } from '../utils/formatDateTime.js';

const resolveStepCardClassName = (status) => {
  if (['completed', 'success', 'analyzed', 'uploaded'].includes(status)) {
    return 'border-emerald-500/20 bg-emerald-500/[0.08]';
  }

  if (['processing', 'uploading', 'checking', 'analyzing', 'polling'].includes(status)) {
    return 'border-brand-500/20 bg-brand-500/[0.08]';
  }

  if (['fallback', 'degraded'].includes(status)) {
    return 'border-amber-500/20 bg-amber-500/[0.08]';
  }

  if (['failed', 'error', 'offline'].includes(status)) {
    return 'border-accent-500/20 bg-accent-500/[0.08]';
  }

  if (status === 'pending') {
    return 'border-white/[0.12] bg-white/[0.05]';
  }

  return 'border-white/10 bg-black/20';
};

const CompactStat = ({ label, value, note }) => {
  return (
    <div className="compact-stat-card">
      <p className="compact-stat-label">{label}</p>
      <p className="compact-stat-value">{value}</p>
      <p className="compact-stat-note">{note}</p>
    </div>
  );
};

const MainPage = () => {
  const [systemModalOpen, setSystemModalOpen] = useState(false);
  const { backendStatus, errorMessage, lastCheckedAt, realtimeStatus, providerStatuses } = useAppHealth();
  const {
    currentVideo,
    videos,
    uploadProgress,
    uploadStatus,
    uploadError,
    validationMessage,
    uploadStartedAt,
    uploadLimit,
    uploadSelectedFile
  } = useVideoUpload();
  const { analysis, loading, error, progress, status, statusMessage, runAnalysis } = useAnalysis();
  const { segments, splitProgress, segmentsLoading, segmentsError, splitFromAnalysis } = useSegments();
  const {
    backgroundAssets,
    backgroundAssetsLoading,
    backgroundAssetsError,
    mergeProgress,
    analyzingSegmentId,
    optimizingSegmentId,
    generatingSegmentIds,
    generatingShotKeys,
    batchGeneratingSegmentIds,
    optimizingShotKeys,
    savingShotSegmentIds,
    setSegmentPrompt,
    setShotPrompt,
    analyzeSegmentById,
    optimizeSegmentPrompt,
    optimizeShotPrompt,
    saveSegmentShotDefinitions,
    generateSegmentVideo,
    generateShotVideo,
    generateAllShotsForSegment,
    startMerge,
    downloadMergedVideo
  } = useGeneration();

  const generatedSegments = segments.filter((segment) => segment.generatedUrl).length;
  const promptsReady = segments.filter((segment) => segment.prompt?.trim()).length;
  const activeGenerationCount = generatingSegmentIds.length;
  const readyBackgroundAssets = backgroundAssets.filter((asset) => asset.status === 'completed').length;
  const uploadStageStatus = currentVideo
    ? 'uploaded'
    : uploadStatus === 'uploading'
      ? 'uploading'
      : uploadError
        ? 'error'
        : 'idle';
  const analysisStageStatus = error
    ? 'failed'
    : loading || status === 'processing'
      ? 'processing'
      : analysis?.is_mock
        ? 'fallback'
        : analysis
          ? 'completed'
          : currentVideo
            ? 'pending'
            : 'idle';
  const splitStageStatus = segmentsError
    ? 'failed'
    : splitProgress.status === 'processing' || segmentsLoading
      ? 'processing'
      : segments.length
        ? 'completed'
        : analysis
          ? 'pending'
          : 'idle';
  const generateStageStatus = activeGenerationCount
    ? 'processing'
    : generatedSegments
      ? 'completed'
      : segments.length
        ? 'pending'
        : 'idle';
  const mergeStageStatus =
    mergeProgress.status === 'completed'
      ? 'completed'
      : mergeProgress.status === 'processing' || mergeProgress.status === 'pending'
        ? 'processing'
        : mergeProgress.errorMessage
          ? 'failed'
          : currentVideo && segments.length
            ? 'pending'
            : 'idle';
  const backendStatusLabel =
    backendStatus === 'online'
      ? '在线'
      : backendStatus === 'degraded'
        ? '降级'
        : backendStatus === 'offline'
          ? '离线'
          : '检查中';
  const analysisSourceLabel = analysis?.is_mock ? 'Mock 回退' : analysis ? '真实 Gemini' : '等待分析';

  const topMetrics = [
    {
      label: '视频',
      value: videos.length,
      note: currentVideo?.filename || '未选择'
    },
    {
      label: '角色',
      value: analysis?.characters?.length ?? 0,
      note: analysis ? analysisSourceLabel : '待提取'
    },
    {
      label: '片段',
      value: segments.length,
      note: segments.length ? '已入工位' : '待切分'
    },
    {
      label: '背景',
      value: readyBackgroundAssets,
      note: backgroundAssets.length ? `${backgroundAssets.length} 个场景` : '待命中'
    },
    {
      label: '导出',
      value: generatedSegments,
      note: activeGenerationCount ? `${activeGenerationCount} 个运行中` : '待生成'
    }
  ];

  const workflowSteps = [
    {
      id: 'upload',
      label: '上传素材',
      description: currentVideo ? '已进入当前项目上下文。' : '选择原始视频作为整片分析输入。',
      status: uploadStageStatus,
      meta:
        uploadStatus === 'uploading'
          ? `上传进度 ${uploadProgress}%`
          : currentVideo
            ? currentVideo.filename
            : '支持 MP4 / MOV / AVI'
    },
    {
      id: 'analysis',
      label: '整片分析',
      description: analysis ? '剧情、角色、场景和切分预案已完成。' : '发送整片视频做场景和角色理解。',
      status: analysisStageStatus,
      meta: analysis ? analysisSourceLabel : statusMessage || '等待开始分析'
    },
    {
      id: 'split',
      label: '片段工位',
      description: segments.length ? '切分完成，可逐段处理。' : '等待整片分析输出切分结果。',
      status: splitStageStatus,
      meta: segments.length ? `${segments.length} 个片段` : splitProgress.message || '等待切分'
    },
    {
      id: 'generate',
      label: '片段生成',
      description: segments.length ? '每段都可分析、优化、生成。' : '切分完成后可逐段处理。',
      status: generateStageStatus,
      meta: generatedSegments ? `${generatedSegments} 条已生成` : '等待生成任务'
    },
    {
      id: 'merge',
      label: '导出成片',
      description: '优先使用已生成片段，缺失部分自动回退原片。',
      status: mergeStageStatus,
      meta:
        mergeProgress.status === 'completed'
          ? '成片可下载'
          : mergeProgress.message || '等待拼接'
    }
  ];

  const operatorChecklist = [
    { label: '项目上下文', done: Boolean(currentVideo), note: currentVideo?.filename || '未选择素材' },
    { label: '整片理解', done: Boolean(analysis), note: analysis ? analysisSourceLabel : '待分析' },
    { label: '片段就绪', done: segments.length > 0, note: segments.length ? `${segments.length} 个片段` : '待切分' },
    { label: '成片下载', done: mergeProgress.status === 'completed', note: mergeProgress.status === 'completed' ? '可直接下载' : '待拼接' }
  ];

  const issueMessages = [
    uploadError,
    errorMessage,
    error,
    segmentsError,
    backgroundAssetsError,
    mergeProgress.errorMessage,
    backendStatus === 'offline' || providerStatuses.seedance.ready
      ? ''
      : `Seedance 未就绪：${providerStatuses.seedance.reason || '缺少必要配置。'}`,
    backendStatus === 'offline' || providerStatuses.geminiImage.ready
      ? ''
      : `Gemini 生图未就绪：${providerStatuses.geminiImage.reason || '缺少必要配置。'}`,
    analysis?.is_mock ? '当前整片分析回退到了 mock 结果，请关注系统状态中的调用说明。' : ''
  ].filter(Boolean);

  return (
    <>
      <a href="#studio-main" className="studio-skip-link">
        跳到主要工作台
      </a>

      <main className="dashboard-shell compact-console">
        <div className="dashboard-orb dashboard-orb-left" />
        <div className="dashboard-orb dashboard-orb-right" />

        <header className="panel-shell panel-shell-strong compact-topbar">
          <div className="compact-topbar-brand">
            <div className="compact-topbar-logo">FV</div>
            <div className="min-w-0">
              <p className="compact-topbar-eyebrow">Fanshi Vidio Clone</p>
              <h1 className="compact-topbar-title">AI 片段控制台</h1>
              <p className="compact-topbar-subtitle">
                顶部状态栏 + 双列工作台。左列聚合项目、上传与整片资源，右列专注片段工位，导出固定在右下角。
              </p>
            </div>
          </div>

          <div className="compact-topbar-metrics">
            {topMetrics.map((item) => (
              <CompactStat key={item.label} label={item.label} value={item.value} note={item.note} />
            ))}
          </div>

          <div className="compact-topbar-actions">
            <StatusBadge status={backendStatus} label={`后端 ${backendStatusLabel}`} />
            <StatusBadge
              status={realtimeStatus}
              label={realtimeStatus === 'realtime' ? '实时通道已连接' : '实时通道监控中'}
            />
            <StatusBadge status={analysisStageStatus} label={`分析态 ${analysisSourceLabel}`} />
            <button
              type="button"
              className="console-chip transition hover:border-white/20 hover:bg-white/[0.08]"
              onClick={() => setSystemModalOpen(true)}
            >
              <span>系统状态</span>
              <span className="font-bold text-white">{issueMessages.length || 0}</span>
            </button>
          </div>
        </header>

        <div id="studio-main" className="compact-studio-grid">
          <div className="compact-studio-cell">
            <div className="compact-cell-stack">
              <section className="panel-shell panel-shell-strong compact-brief-panel">
                <div className="compact-brief-header">
                  <div>
                    <p className="compact-card-eyebrow">Project</p>
                    <h2 className="compact-card-title">项目与上传</h2>
                  </div>
                  <StatusBadge
                    status={issueMessages.length ? 'fallback' : 'online'}
                    label={issueMessages.length ? `${issueMessages.length} 个提醒` : '运行稳定'}
                  />
                </div>

                <div className="compact-brief-grid">
                  <div className="compact-info-tile">
                    <p className="compact-info-label">当前素材</p>
                    <p className="compact-info-value">{currentVideo?.filename || '未选择'}</p>
                  </div>
                  <div className="compact-info-tile">
                    <p className="compact-info-label">上传限制</p>
                    <p className="compact-info-value">{Math.round(uploadLimit / 1024 / 1024)} MB</p>
                  </div>
                  <div className="compact-info-tile">
                    <p className="compact-info-label">最近上传</p>
                    <p className="compact-info-value">
                      {uploadStartedAt ? formatDateTime(uploadStartedAt) : '暂无记录'}
                    </p>
                  </div>
                  <div className="compact-info-tile">
                    <p className="compact-info-label">最近检查</p>
                    <p className="compact-info-value">
                      {lastCheckedAt ? formatDateTime(lastCheckedAt) : '等待首次检查'}
                    </p>
                  </div>
                </div>

                <div className="compact-checklist-grid">
                  {operatorChecklist.map((item) => (
                    <div key={item.label} className="compact-checklist-item">
                      <div>
                        <p className="compact-checklist-label">{item.label}</p>
                        <p className="compact-checklist-note">{item.note}</p>
                      </div>
                      <StatusBadge status={item.done ? 'completed' : 'idle'} />
                    </div>
                  ))}
                </div>
              </section>

              <UploadArea
                currentVideo={currentVideo}
                videos={videos}
                uploadProgress={uploadProgress}
                uploadStatus={uploadStatus}
                uploadError={uploadError}
                validationMessage={validationMessage}
                uploadStartedAt={uploadStartedAt}
                uploadLimit={uploadLimit}
                onUpload={uploadSelectedFile}
                compactMode
                className="compact-surface"
              />

              <AnalysisDisplay
                video={currentVideo}
                analysis={analysis}
                backgroundAssets={backgroundAssets}
                backgroundAssetsLoading={backgroundAssetsLoading}
                backgroundAssetsError={backgroundAssetsError}
                loading={loading}
                error={error}
                progress={progress}
                status={status}
                statusMessage={statusMessage}
                splitProgress={splitProgress}
                onAnalyze={runAnalysis}
                onSplit={splitFromAnalysis}
                compactMode
                className="compact-surface compact-analysis-panel"
              />
            </div>
          </div>

          <div className="compact-studio-cell">
            <section className="panel-shell panel-shell-strong compact-surface compact-workbench-panel">
              <div className="compact-panel-header">
                <div>
                  <p className="compact-card-eyebrow">Workbench</p>
                  <h2 className="compact-card-title">片段工作台</h2>
                  <p className="compact-card-note">
                    右上固定为片段工位。每个片段都保持单卡常驻，只展示预览、最终提示词、生成结果和关键操作。
                  </p>
                </div>
                <StatusBadge
                  status={splitStageStatus}
                  label={segments.length ? `${segments.length} 个片段` : '等待切分'}
                />
              </div>

              <div className="stage-toolbar compact-toolbar">
                <span className="toolbar-pill">Prompt 就绪 {promptsReady}</span>
                <span className="toolbar-pill">运行中 {activeGenerationCount}</span>
                <span className="toolbar-pill">已生成 {generatedSegments}</span>
                <span className="toolbar-pill">背景资产 {readyBackgroundAssets}</span>
              </div>

              {segmentsError ? (
                <div
                  role="alert"
                  className="mt-3 rounded-[18px] border border-accent-500/20 bg-accent-500/10 px-3 py-3 text-xs text-rose-200"
                >
                  {segmentsError}
                </div>
              ) : null}

              <div className="compact-segment-scroll">
                {segments.length ? (
                  segments.map((segment) => (
                    <SegmentCard
                      key={segment.id}
                      segment={segment}
                      overallAnalysis={analysis}
                      timeAnchor={analysis?.time_anchors?.[segment.segmentIndex] || null}
                      backgroundAsset={
                        backgroundAssets.find((asset) => asset.backgroundId === segment.backgroundId) || null
                      }
                      expanded={false}
                      onToggle={() => {}}
                      onPromptChange={setSegmentPrompt}
                      onShotPromptChange={setShotPrompt}
                      onAnalyze={analyzeSegmentById}
                      onOptimize={optimizeSegmentPrompt}
                      onOptimizeShot={optimizeShotPrompt}
                      onGenerate={generateSegmentVideo}
                      onGenerateShot={generateShotVideo}
                      onGenerateAllShots={generateAllShotsForSegment}
                      onSaveShots={saveSegmentShotDefinitions}
                      isAnalyzing={analyzingSegmentId === segment.id}
                      isOptimizing={optimizingSegmentId === segment.id}
                      isGenerating={generatingSegmentIds.includes(segment.id)}
                      generatingShotKeys={generatingShotKeys}
                      isBatchGenerating={batchGeneratingSegmentIds.includes(segment.id)}
                      optimizingShotKeys={optimizingShotKeys}
                      isSavingShots={savingShotSegmentIds.includes(segment.id)}
                    />
                  ))
                ) : (
                  <div className="preview-placeholder min-h-[220px]">
                    <div className="preview-orb" />
                    <p className="text-base font-semibold text-white">还没有片段卡片</p>
                    <p className="mt-2 max-w-sm text-center text-xs leading-5 text-white/60">
                      先完成整片分析并点击“生成片段”，这里就会出现可编辑、可生成、可回看上下文的片段工位。
                    </p>
                  </div>
                )}
              </div>
            </section>
          </div>

        </div>

        <div className="floating-export-dock">
          <section className="floating-export-checklist">
            <div className="floating-export-header">
              <div>
                <p className="floating-export-eyebrow">Export Checklist</p>
                <h2 className="floating-export-title">导出前检查</h2>
              </div>
              <StatusBadge
                status={mergeStageStatus}
                label={mergeProgress.status === 'completed' ? '可下载' : '待导出'}
              />
            </div>

            <div className="floating-export-grid">
              <div className="floating-export-metric">
                <span className="floating-export-label">片段覆盖率</span>
                <span className="floating-export-value">
                  {generatedSegments} / {segments.length || 0}
                </span>
              </div>
              <div className="floating-export-metric">
                <span className="floating-export-label">背景资产</span>
                <span className="floating-export-value">
                  {readyBackgroundAssets} / {backgroundAssets.length || 0}
                </span>
              </div>
            </div>

            <div className="compact-issue-list">
              {issueMessages.length ? (
                issueMessages.slice(0, 2).map((message, index) => (
                  <div key={`${message}-${index}`} className="compact-issue-item">
                    {message}
                  </div>
                ))
              ) : (
                <div className="compact-issue-item compact-issue-item-success">
                  当前没有异常提醒，可以继续片段生成或直接导出。
                </div>
              )}
            </div>
          </section>

          <VideoMerge
            video={currentVideo}
            segments={segments}
            mergeProgress={mergeProgress}
            onMerge={startMerge}
            onDownload={downloadMergedVideo}
            compactMode
            dockMode
          />
        </div>

        <ModalSheet
          open={systemModalOpen}
          onClose={() => setSystemModalOpen(false)}
          title="系统状态与工作流"
          description="这里集中显示后端联调状态、工作流进度、操作建议和异常提醒。"
          size="xl"
        >
          <div className="space-y-5">
            <section className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
              <div className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">联调状态</p>
                  <StatusBadge status={backendStatus} label={`后端 ${backendStatusLabel}`} />
                </div>
                <p className="mt-3 text-xs leading-6 text-white/55">
                  {errorMessage || '健康检查通过，前端可继续调用真实服务。'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <StatusBadge
                    status={realtimeStatus}
                    label={realtimeStatus === 'realtime' ? '实时推送' : '监控中'}
                  />
                  <StatusBadge
                    status={providerStatuses.seedance.ready ? 'completed' : 'fallback'}
                    label={
                      providerStatuses.seedance.ready
                        ? 'Seedance 已就绪'
                        : 'Seedance 未就绪'
                    }
                  />
                  <StatusBadge
                    status={providerStatuses.geminiImage.ready ? 'completed' : 'fallback'}
                    label={
                      providerStatuses.geminiImage.ready
                        ? 'Gemini 生图已就绪'
                        : 'Gemini 生图未就绪'
                    }
                  />
                  <span className="toolbar-pill">
                    最近检查 {lastCheckedAt ? formatDateTime(lastCheckedAt) : '暂无'}
                  </span>
                </div>
              </div>

              <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4">
                <p className="text-sm font-semibold text-white">需要处理的提醒</p>
                {issueMessages.length ? (
                  <ul className="mt-3 space-y-2 text-xs leading-5 text-white/70">
                    {issueMessages.map((message, index) => (
                      <li key={`${message}-${index}`} className="rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3">
                        {message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs leading-6 text-white/55">
                    当前没有异常提醒，可以继续处理片段 Prompt、生成和成片输出。
                  </p>
                )}
              </div>
            </section>

            <section>
              <p className="glass-label">Workflow</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {workflowSteps.map((step, index) => (
                  <article key={step.id} className={`workflow-step ${resolveStepCardClassName(step.status)}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-white/40">
                          Step {String(index + 1).padStart(2, '0')}
                        </p>
                        <h3 className="mt-2 text-base font-semibold text-white">{step.label}</h3>
                      </div>
                      <StatusBadge status={step.status} />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-white/70">{step.description}</p>
                    <p className="mt-4 text-xs leading-5 text-white/40">{step.meta}</p>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </ModalSheet>
      </main>
    </>
  );
};

export default MainPage;
