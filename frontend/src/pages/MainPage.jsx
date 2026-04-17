import AnalysisDisplay from '../components/AnalysisDisplay.jsx';
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

const MainPage = () => {
  const { backendStatus, errorMessage, lastCheckedAt, realtimeStatus } = useAppHealth();
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
    mergeProgress,
    analyzingSegmentId,
    optimizingSegmentId,
    generatingSegmentIds,
    setSegmentPrompt,
    analyzeSegmentById,
    optimizeSegmentPrompt,
    generateSegmentVideo,
    startMerge,
    downloadMergedVideo
  } = useGeneration();

  const generatedSegments = segments.filter((segment) => segment.generatedUrl).length;
  const promptsReady = segments.filter((segment) => segment.prompt?.trim()).length;
  const activeGenerationCount = generatingSegmentIds.length;
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
  const promptStageStatus = promptsReady
    ? 'completed'
    : segments.length
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

  const metricCards = [
    {
      label: '上传视频',
      value: videos.length,
      detail: currentVideo?.filename || '等待素材进入'
    },
    {
      label: '角色数量',
      value: analysis?.characters?.length ?? 0,
      detail: analysis ? analysisSourceLabel : '尚未提取'
    },
    {
      label: '片段数量',
      value: segments.length,
      detail: segments.length ? '已切分至工作区' : '等待切分'
    },
    {
      label: '已生成',
      value: generatedSegments,
      detail: activeGenerationCount ? `${activeGenerationCount} 个任务运行中` : '等待生成'
    }
  ];

  const workflowSteps = [
    {
      id: 'upload',
      label: '上传素材',
      description: currentVideo ? '源视频已进入当前项目上下文。' : '选择一条原始视频，作为整片分析与切分的输入。',
      status: uploadStageStatus,
      meta:
        uploadStatus === 'uploading'
          ? `上传进度 ${uploadProgress}%`
          : currentVideo
            ? currentVideo.filename
            : `支持 MP4 / MOV / AVI`
    },
    {
      id: 'analysis',
      label: '整片分析',
      description: analysis
        ? '已获得剧情、角色、背景和时间锚点。'
        : '把整片视频和分析提示词一起发给模型，提取全局结构。',
      status: analysisStageStatus,
      meta: analysis ? analysisSourceLabel : statusMessage || '等待开始分析'
    },
    {
      id: 'split',
      label: '镜头拆分',
      description: segments.length
        ? '镜头切分完成，可以逐段进入精修工作台。'
        : '根据分析出的时间锚点生成可操作的片段卡片。',
      status: splitStageStatus,
      meta: segments.length ? `${segments.length} 个片段` : splitProgress.message || '等待切分'
    },
    {
      id: 'prompt',
      label: 'Prompt 优化',
      description: segments.length
        ? '逐条编辑片段提示词，保持角色一致性并补足镜头意图。'
        : '切分完成后会开放片段 Prompt 编辑器和标签高亮预览。',
      status: promptStageStatus,
      meta: segments.length ? `${promptsReady}/${segments.length} 条已带 Prompt` : '等待片段工位'
    },
    {
      id: 'generate',
      label: '分镜生成',
      description: segments.length
        ? '每个片段都可单独分析、优化并生成新镜头。'
        : '切分完成后可按片段独立生成。',
      status: generateStageStatus,
      meta: generatedSegments ? `${generatedSegments} 条已生成` : '等待生成任务'
    },
    {
      id: 'merge',
      label: '合成导出',
      description: '拼接任务优先使用已生成片段，其余部分自动回退到原始素材。',
      status: mergeStageStatus,
      meta:
        mergeProgress.status === 'completed'
          ? '成片可下载'
          : mergeProgress.message || '等待拼接'
    }
  ];

  const operatorChecklist = [
    { label: '已选择原视频', done: Boolean(currentVideo), note: currentVideo?.filename || '未选择素材' },
    {
      label: '整片分析结果就绪',
      done: Boolean(analysis),
      note: analysis ? analysisSourceLabel : '待分析'
    },
    {
      label: '片段卡片已生成',
      done: segments.length > 0,
      note: segments.length ? `${segments.length} 个片段` : '待切分'
    },
    {
      label: '成片可导出',
      done: mergeProgress.status === 'completed',
      note: mergeProgress.status === 'completed' ? '可直接下载' : '待拼接'
    }
  ];

  const issueMessages = [
    uploadError,
    errorMessage,
    error,
    segmentsError,
    mergeProgress.errorMessage,
    analysis?.is_mock ? '当前整片分析回退到了 mock 结果，请关注右侧任务说明。' : ''
  ].filter(Boolean);

  return (
    <>
      <a href="#studio-main" className="studio-skip-link">
        跳到主要工作台
      </a>

      <main className="dashboard-shell">
        <div className="dashboard-orb dashboard-orb-left" />
        <div className="dashboard-orb dashboard-orb-right" />

        <header className="hero-shell">
          <div className="hero-grid">
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.08] text-xl font-black text-white">
                    FV
                  </div>
                  <div>
                    <p className="glass-label">Fanshi Vidio Clone</p>
                    <h1 className="mt-2 text-3xl font-black tracking-tight text-white md:text-5xl">
                      AI 视频复刻工作台
                    </h1>
                  </div>
                </div>

                <div className="console-chip">
                  <span>Operator</span>
                  <span className="font-bold text-white">Jeffrey Zhu</span>
                </div>
              </div>

              <p className="max-w-4xl text-base leading-8 text-white/70">
                现在的页面会被重排成更接近电影控制台的工作方式。上传源视频后，可以在同一套工作台里完成整片理解、镜头拆分、
                Prompt 优化、分镜生成、合成导出和异常定位。
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={backendStatus} label={`后端 ${backendStatusLabel}`} />
                <StatusBadge status={realtimeStatus} label={`实时通道 ${realtimeStatus === 'realtime' ? '已连接' : '监控中'}`} />
                <StatusBadge status={analysisStageStatus} label={`分析态 ${analysisSourceLabel}`} />
                <span className="console-chip">
                  最近健康检查：{lastCheckedAt ? formatDateTime(lastCheckedAt) : '等待首次检查'}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {metricCards.map((card) => (
                  <div key={card.label} className="hero-metric">
                    <p className="text-xs uppercase tracking-[0.26em] text-white/50">{card.label}</p>
                    <p className="mt-3 text-3xl font-black text-white">{card.value}</p>
                    <p className="mt-2 text-sm leading-6 text-white/60">{card.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <aside className="space-y-4">
              <section className="console-card">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="glass-label">Mission Control</p>
                    <h2 className="mt-3 text-xl font-black text-white">系统与任务概况</h2>
                  </div>
                  <StatusBadge status={issueMessages.length ? 'fallback' : 'online'} label={`${issueMessages.length} 个提醒`} />
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="console-kpi">
                    <p className="text-xs uppercase tracking-[0.22em] text-white/40">当前素材</p>
                    <p className="mt-2 text-sm font-semibold text-white">
                      {currentVideo?.filename || '还未建立项目上下文'}
                    </p>
                  </div>
                  <div className="console-kpi">
                    <p className="text-xs uppercase tracking-[0.22em] text-white/40">任务状态</p>
                    <p className="mt-2 text-sm font-semibold text-white">
                      {mergeProgress.status === 'processing'
                        ? '成片拼接中'
                        : activeGenerationCount
                          ? '分镜生成中'
                          : loading
                            ? '整片分析中'
                            : '等待操作'}
                    </p>
                  </div>
                  <div className="console-kpi">
                    <p className="text-xs uppercase tracking-[0.22em] text-white/40">异常提醒</p>
                    <p className="mt-2 text-sm font-semibold text-white">{issueMessages.length || 0} 条</p>
                  </div>
                  <div className="console-kpi">
                    <p className="text-xs uppercase tracking-[0.22em] text-white/40">最近上传</p>
                    <p className="mt-2 text-sm font-semibold text-white">
                      {uploadStartedAt ? formatDateTime(uploadStartedAt) : '暂无上传记录'}
                    </p>
                  </div>
                </div>
              </section>

              <section className="console-card">
                <p className="glass-label">Operator Checklist</p>
                <div className="mt-4 space-y-3">
                  {operatorChecklist.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-start justify-between gap-3 rounded-[20px] border border-white/10 bg-black/20 px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-semibold text-white">{item.label}</p>
                        <p className="mt-1 text-xs leading-5 text-white/50">{item.note}</p>
                      </div>
                      <StatusBadge status={item.done ? 'completed' : 'idle'} />
                    </div>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        </header>

        <section className="workflow-shell" aria-label="工作流步骤">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="glass-label">Workflow Rail</p>
              <h2 className="mt-3 text-2xl font-black text-white">六步工作流总控</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
                每一步都保留了现在已有的功能，只是把它们移到了更清晰的控制台顺序里，方便运营和联调人员判断当前卡在哪个阶段。
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="toolbar-pill">健康检查 {backendStatusLabel}</span>
              <span className="toolbar-pill">当前片段 {segments.length}</span>
              <span className="toolbar-pill">生成完成 {generatedSegments}</span>
            </div>
          </div>

          <div className="workflow-track">
            {workflowSteps.map((step, index) => (
              <article
                key={step.id}
                className={`workflow-step ${resolveStepCardClassName(step.status)}`}
              >
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

        <div id="studio-main" className="workspace-grid">
          <aside className="rail-sticky">
            <section className="panel-shell p-5 md:p-6">
              <p className="glass-label">Source Feed</p>
              <h2 className="mt-3 text-2xl font-black text-white">素材上下文</h2>
              <p className="mt-2 text-sm leading-6 text-white/60">
                左侧固定保留源素材与上传状态，方便在长列表操作分镜时随时确认当前项目。
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
                <div className="surface-muted px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-white/40">当前视频</p>
                  <p className="mt-2 text-sm font-semibold text-white">
                    {currentVideo?.filename || '尚未选择'}
                  </p>
                </div>
                <div className="surface-muted px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-white/40">上传状态</p>
                  <div className="mt-2">
                    <StatusBadge status={uploadStageStatus} label={uploadStatus === 'uploading' ? `上传中 ${uploadProgress}%` : undefined} />
                  </div>
                </div>
                <div className="surface-muted px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-white/40">上传限制</p>
                  <p className="mt-2 text-sm font-semibold text-white">{Math.round(uploadLimit / 1024 / 1024)} MB</p>
                </div>
                <div className="surface-muted px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-white/40">最近上传</p>
                  <p className="mt-2 text-sm font-semibold text-white">
                    {uploadStartedAt ? formatDateTime(uploadStartedAt) : '暂无记录'}
                  </p>
                </div>
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
            />
          </aside>

          <section className="space-y-6">
            <AnalysisDisplay
              video={currentVideo}
              analysis={analysis}
              loading={loading}
              error={error}
              progress={progress}
              status={status}
              statusMessage={statusMessage}
              splitProgress={splitProgress}
              onAnalyze={runAnalysis}
              onSplit={splitFromAnalysis}
            />

            <section className="panel-shell panel-shell-strong p-5 md:p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-5">
                <div>
                  <p className="glass-label">Segment Workbench</p>
                  <h2 className="mt-3 text-2xl font-black tracking-tight text-white">片段卡片列表</h2>
                  <p className="mt-2 text-sm leading-6 text-white/60">
                    每张卡片都保留原片预览、片段分析、Prompt 编辑、优化调用词、角色展开结果和独立生成能力。
                  </p>
                </div>
                <StatusBadge status={splitStageStatus} label={segments.length ? `${segments.length} 个片段` : '等待切分'} />
              </div>

              <div className="stage-toolbar">
                <span className="toolbar-pill">片段总数 {segments.length}</span>
                <span className="toolbar-pill">Prompt 就绪 {promptsReady}</span>
                <span className="toolbar-pill">生成完成 {generatedSegments}</span>
                <span className="toolbar-pill">运行中 {activeGenerationCount}</span>
              </div>

              {segmentsError ? (
                <div
                  role="alert"
                  className="mt-4 rounded-[24px] border border-accent-500/20 bg-accent-500/10 px-4 py-3 text-sm text-rose-200"
                >
                  {segmentsError}
                </div>
              ) : null}

              <div className="segment-scroll mt-5">
                {segments.length ? (
                  <div className="segment-grid">
                    {segments.map((segment) => (
                      <SegmentCard
                        key={segment.id}
                        segment={segment}
                        overallAnalysis={analysis}
                        onPromptChange={setSegmentPrompt}
                        onAnalyze={analyzeSegmentById}
                        onOptimize={optimizeSegmentPrompt}
                        onGenerate={generateSegmentVideo}
                        isAnalyzing={analyzingSegmentId === segment.id}
                        isOptimizing={optimizingSegmentId === segment.id}
                        isGenerating={generatingSegmentIds.includes(segment.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="preview-placeholder min-h-[320px]">
                    <div className="preview-orb" />
                    <p className="text-xl font-semibold text-white">还没有片段卡片</p>
                    <p className="mt-2 max-w-sm text-center text-sm leading-6 text-white/60">
                      先完成整片分析并点击“生成片段”，这里就会出现可编辑、可生成、可回看上下文的片段工位。
                    </p>
                  </div>
                )}
              </div>
            </section>
          </section>

          <aside className="rail-sticky">
            <section className="panel-shell p-5 md:p-6">
              <p className="glass-label">System Feed</p>
              <h2 className="mt-3 text-2xl font-black text-white">状态与提醒</h2>
              <div className="mt-5 space-y-3">
                <div className="surface-muted px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-white">后端联调状态</span>
                    <StatusBadge status={backendStatus} />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-white/50">
                    {errorMessage || '健康检查通过，前端可继续调用真实服务。'}
                  </p>
                </div>

                <div className="surface-muted px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-white">实时通道</span>
                    <StatusBadge status={realtimeStatus} />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-white/50">
                    {realtimeStatus === 'realtime'
                      ? '当前优先通过 websocket 接收进度。'
                      : '当前以轮询 / 回退模式监控任务。'}
                  </p>
                </div>

                {issueMessages.length ? (
                  <div
                    role="alert"
                    className="rounded-[24px] border border-amber-500/20 bg-amber-500/10 px-4 py-4"
                  >
                    <p className="text-sm font-semibold text-amber-100">需要处理的提醒</p>
                    <ul className="mt-3 space-y-2 text-xs leading-5 text-amber-50/80">
                      {issueMessages.slice(0, 4).map((message, index) => (
                        <li key={`${message}-${index}`}>• {message}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="surface-muted px-4 py-4">
                    <p className="text-sm font-semibold text-white">当前没有异常提醒</p>
                    <p className="mt-2 text-xs leading-5 text-white/50">
                      可以继续处理片段 Prompt、生成和成片输出。
                    </p>
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
            />

            <section className="panel-shell p-5 md:p-6">
              <p className="glass-label">Operator Notes</p>
              <h2 className="mt-3 text-2xl font-black text-white">操作建议</h2>
              <div className="mt-5 space-y-3">
                <div className="surface-muted px-4 py-4">
                  <p className="text-sm font-semibold text-white">1. 先确认整片分析来源</p>
                  <p className="mt-2 text-xs leading-5 text-white/50">
                    如果显示为 Mock 回退，先看上方提醒和分析区的回退说明，再决定是否继续生成。
                  </p>
                </div>
                <div className="surface-muted px-4 py-4">
                  <p className="text-sm font-semibold text-white">2. 优先修正 Prompt 再生成</p>
                  <p className="mt-2 text-xs leading-5 text-white/50">
                    每个片段都支持先分析、再优化提示词，避免直接生成造成镜头风格不一致。
                  </p>
                </div>
                <div className="surface-muted px-4 py-4">
                  <p className="text-sm font-semibold text-white">3. 合成前确认生成覆盖率</p>
                  <p className="mt-2 text-xs leading-5 text-white/50">
                    当前已生成 {generatedSegments} / {segments.length || 0} 个片段，未生成片段会回退到原视频内容。
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </main>
    </>
  );
};

export default MainPage;
