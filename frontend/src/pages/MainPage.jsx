import AnalysisDisplay from '../components/AnalysisDisplay.jsx';
import SegmentCard from '../components/SegmentCard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import UploadArea from '../components/UploadArea.jsx';
import VideoMerge from '../components/VideoMerge.jsx';
import { useAnalysis, useAppHealth, useGeneration, useSegments, useVideoUpload } from '../hooks/index.js';

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
    optimizingSegmentId,
    generatingSegmentIds,
    setSegmentPrompt,
    optimizeSegmentPrompt,
    generateSegmentVideo,
    startMerge,
    downloadMergedVideo
  } = useGeneration();

  const generatedSegments = segments.filter((segment) => segment.generatedUrl).length;
  const backendStatusLabel =
    backendStatus === 'online'
      ? '在线'
      : backendStatus === 'degraded'
        ? '降级'
        : backendStatus === 'offline'
          ? '离线'
          : '检查中';
  const metricCards = [
    {
      label: '上传视频',
      value: videos.length,
      tone: 'bg-white/10 text-white'
    },
    {
      label: '角色数量',
      value: analysis?.characters?.length ?? 0,
      tone: 'bg-white/10 text-white'
    },
    {
      label: '片段数量',
      value: segments.length,
      tone: 'bg-white/10 text-white'
    },
    {
      label: '已生成',
      value: generatedSegments,
      tone: 'bg-white/10 text-white'
    }
  ];

  return (
    <main className="dashboard-shell">
      <div className="dashboard-orb dashboard-orb-left" />
      <div className="dashboard-orb dashboard-orb-right" />

      <header className="hero-shell">
        <div className="hero-grid">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 text-xl font-black text-white">
                FV
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.34em] text-white/55">
                  Fanshi Vidio Clone
                </p>
                <h1 className="mt-2 text-3xl font-black tracking-tight text-white md:text-5xl">
                  AI 视频复刻单页工作台
                </h1>
              </div>
            </div>

            <p className="max-w-3xl text-base leading-8 text-white/72">
              从原视频上传、整片分析、片段拆分、提示词编辑到最终拼接，全流程都已经在这个页面里串起来了。
              当前版本优先保证真实 API 联调、状态清晰和后续可扩展性。
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={backendStatus} label={`后端 ${backendStatusLabel}`} />
              <StatusBadge status={realtimeStatus} />
              <span className="rounded-full bg-white/10 px-4 py-2 text-sm text-white/80">
                {errorMessage || `最近健康检查：${lastCheckedAt || '等待首次检查'}`}
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metricCards.map((card) => (
              <div key={card.label} className={`hero-metric ${card.tone}`}>
                <p className="text-xs uppercase tracking-[0.26em] text-white/55">{card.label}</p>
                <p className="mt-3 text-3xl font-black">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-[28px] border border-white/10 bg-white/10 px-5 py-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-white/45">Studio User</p>
              <p className="mt-2 text-sm font-semibold text-white">Jeffrey Zhu</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-sm font-bold text-white">
              JZ
            </div>
          </div>
        </div>
      </header>

      <div className="workspace-grid">
        <div className="space-y-6">
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

          <VideoMerge
            video={currentVideo}
            segments={segments}
            mergeProgress={mergeProgress}
            onMerge={startMerge}
            onDownload={downloadMergedVideo}
          />
        </div>

        <div className="space-y-6">
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
        </div>

        <section className="panel-shell p-5 md:p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-brand-700">
                Segments
              </p>
              <h2 className="mt-3 text-2xl font-black tracking-tight text-ink-900">片段卡片列表</h2>
              <p className="mt-2 text-sm leading-6 text-ink-700">
                每张卡片都可以预览原始片段、优化提示词并单独生成新镜头。
              </p>
            </div>
            <StatusBadge status={segmentsLoading ? 'processing' : segments.length ? 'completed' : 'idle'} />
          </div>

          {segmentsError ? (
            <div className="mb-4 rounded-[24px] border border-accent-100 bg-accent-50/80 px-4 py-3 text-sm text-accent-700">
              {segmentsError}
            </div>
          ) : null}

          <div className="segment-scroll space-y-4">
            {segments.length ? (
              segments.map((segment) => (
                <SegmentCard
                  key={segment.id}
                  segment={segment}
                  onPromptChange={setSegmentPrompt}
                  onOptimize={optimizeSegmentPrompt}
                  onGenerate={generateSegmentVideo}
                  isOptimizing={optimizingSegmentId === segment.id}
                  isGenerating={generatingSegmentIds.includes(segment.id)}
                />
              ))
            ) : (
              <div className="preview-placeholder min-h-[320px] rounded-[32px] border border-dashed border-slate-200">
                <div className="preview-orb" />
                <p className="text-xl font-semibold text-ink-900">还没有片段卡片</p>
                <p className="mt-2 max-w-sm text-center text-sm leading-6 text-ink-500">
                  先完成整片分析并点击“生成片段”，这里就会出现可编辑、可生成的片段卡片。
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
};

export default MainPage;
