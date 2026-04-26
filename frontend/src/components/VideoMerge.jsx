import PropTypes from 'prop-types';

import ProgressBar from './ProgressBar.jsx';
import SectionPanel from './SectionPanel.jsx';
import StatusBadge from './StatusBadge.jsx';

const VideoMerge = ({
  video = null,
  segments = [],
  mergeProgress = {
    status: 'idle',
    progress: 0,
    message: '',
    errorMessage: '',
    updatedAt: ''
  },
  segmentExportProgress = {
    status: 'idle',
    progress: 0,
    message: '',
    errorMessage: '',
    updatedAt: ''
  },
  className = '',
  compactMode = false,
  dockMode = false,
  onMerge,
  onDownload,
  onExportSegments,
  onDownloadSegments
}) => {
  const generatedSegments = segments.filter((segment) => segment.generatedUrl).length;
  const canMerge = Boolean(video?.id) && segments.length > 0 && generatedSegments === segments.length;
  const isMerging = mergeProgress.status === 'processing' || mergeProgress.status === 'pending';
  const isCompleted = mergeProgress.status === 'completed';
  const isExportingSegments =
    segmentExportProgress.status === 'processing' || segmentExportProgress.status === 'pending';
  const isSegmentExportCompleted = segmentExportProgress.status === 'completed';

  if (dockMode) {
    return (
      <section className={`floating-export-card ${className}`}>
        <div className="floating-export-header">
          <div>
            <p className="floating-export-eyebrow">Export Dock</p>
            <h2 className="floating-export-title">成片拼接</h2>
          </div>
          <StatusBadge status={mergeProgress.status} />
        </div>

        <p className="floating-export-copy">只使用真实生成完成的片段导出，缺失结果时会直接报错提醒。</p>

        <div className="floating-export-grid">
          <div className="floating-export-metric">
            <span className="floating-export-label">项目</span>
            <span className="floating-export-value">{video?.filename || '未选择视频'}</span>
          </div>
          <div className="floating-export-metric">
            <span className="floating-export-label">片段</span>
            <span className="floating-export-value">{segments.length}</span>
          </div>
          <div className="floating-export-metric">
            <span className="floating-export-label">已生成</span>
            <span className="floating-export-value">{generatedSegments}</span>
          </div>
        </div>

        {mergeProgress.status !== 'idle' ? (
          <div className="mt-3 rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2.5">
            <ProgressBar
              value={mergeProgress.progress}
              status={mergeProgress.status}
              label={mergeProgress.message || '正在拼接视频'}
              startedAt={mergeProgress.updatedAt}
            />
          </div>
        ) : null}

        {segmentExportProgress.status !== 'idle' ? (
          <div className="mt-3 rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2.5">
            <ProgressBar
              value={segmentExportProgress.progress}
              status={segmentExportProgress.status}
              label={segmentExportProgress.message || '正在导出片段压缩包'}
              startedAt={segmentExportProgress.updatedAt}
            />
          </div>
        ) : null}

        {mergeProgress.errorMessage ? (
          <div
            role="alert"
            className="mt-3 rounded-[16px] border border-accent-500/20 bg-accent-500/10 px-3 py-2 text-[11px] leading-5 text-rose-200"
          >
            {mergeProgress.errorMessage}
          </div>
        ) : null}

        {segmentExportProgress.errorMessage ? (
          <div
            role="alert"
            className="mt-3 rounded-[16px] border border-accent-500/20 bg-accent-500/10 px-3 py-2 text-[11px] leading-5 text-rose-200"
          >
            {segmentExportProgress.errorMessage}
          </div>
        ) : null}

        {isCompleted ? (
          <div className="mt-3 rounded-[16px] border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] leading-5 text-emerald-200">
            拼接完成，可以直接下载成片。
          </div>
        ) : null}

        {isSegmentExportCompleted ? (
          <div className="mt-3 rounded-[16px] border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] leading-5 text-emerald-200">
            片段压缩包已就绪，可以直接下载。
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="flex-1 rounded-full bg-gradient-to-r from-brand-500 to-accent-500 px-4 py-2 text-[11px] font-semibold text-white transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void onMerge()}
            disabled={!canMerge || isMerging}
          >
            {isMerging ? '拼接中...' : '开始拼接'}
          </button>
          <button
            type="button"
            className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[11px] font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void (isSegmentExportCompleted ? onDownloadSegments() : onExportSegments())}
            disabled={!video?.id || isExportingSegments}
          >
            {isExportingSegments ? '打包中...' : isSegmentExportCompleted ? '下载片段压缩包' : '准备片段压缩包'}
          </button>
          <button
            type="button"
            className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[11px] font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void onDownload()}
            disabled={!isCompleted}
          >
            下载成片
          </button>
        </div>
      </section>
    );
  }

  return (
    <SectionPanel
      eyebrow="Merge"
      title="成片拼接"
      description={
        compactMode
          ? '只使用真实生成片段导出。'
          : '拼接任务只使用真实生成完成的片段，没有结果时会直接提示缺失。'
      }
      actions={<StatusBadge status={mergeProgress.status} />}
      compact={compactMode}
      className={className}
    >
      <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.24em] text-white/40">当前项目</p>
            <p className="mt-2 truncate text-sm font-semibold text-white">{video?.filename || '未选择视频'}</p>
            <p className="mt-1 text-[11px] leading-5 text-white/55">
              只使用真实生成完成的片段导出，不再用原片片段充数。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-full bg-gradient-to-r from-brand-500 to-accent-500 px-4 py-2.5 text-xs font-semibold text-white transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void onMerge()}
              disabled={!canMerge || isMerging}
            >
              {isMerging ? '拼接中...' : '开始拼接'}
            </button>
            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => void (isSegmentExportCompleted ? onDownloadSegments() : onExportSegments())}
              disabled={!video?.id || isExportingSegments}
            >
              {isExportingSegments ? '打包中...' : isSegmentExportCompleted ? '下载片段压缩包' : '准备片段压缩包'}
            </button>
            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => void onDownload()}
              disabled={!isCompleted}
            >
              下载成片
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">片段数量</p>
            <p className="mt-1 text-sm font-bold text-white">{segments.length}</p>
          </div>
          <div className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">已生成片段</p>
            <p className="mt-1 text-sm font-bold text-white">{generatedSegments}</p>
          </div>
          <div className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">拼接状态</p>
            <div className="mt-1">
              <StatusBadge status={mergeProgress.status} />
            </div>
          </div>
        </div>
      </div>

      {mergeProgress.status !== 'idle' ? (
        <div className="mt-3 rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-3">
          <ProgressBar
            value={mergeProgress.progress}
            status={mergeProgress.status}
            label={mergeProgress.message || '正在拼接视频'}
            startedAt={mergeProgress.updatedAt}
          />
        </div>
      ) : null}

      {segmentExportProgress.status !== 'idle' ? (
        <div className="mt-3 rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-3">
          <ProgressBar
            value={segmentExportProgress.progress}
            status={segmentExportProgress.status}
            label={segmentExportProgress.message || '正在导出片段压缩包'}
            startedAt={segmentExportProgress.updatedAt}
          />
        </div>
      ) : null}

      {mergeProgress.errorMessage ? (
        <div
          role="alert"
          className="mt-3 rounded-[20px] border border-accent-500/20 bg-accent-500/10 px-4 py-3 text-xs leading-5 text-rose-200"
        >
          {mergeProgress.errorMessage}
        </div>
      ) : null}

      {segmentExportProgress.errorMessage ? (
        <div
          role="alert"
          className="mt-3 rounded-[20px] border border-accent-500/20 bg-accent-500/10 px-4 py-3 text-xs leading-5 text-rose-200"
        >
          {segmentExportProgress.errorMessage}
        </div>
      ) : null}

      {isCompleted ? (
        <div className="mt-3 rounded-[20px] border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs leading-5 text-emerald-200">
          拼接完成，可以直接下载成片。
        </div>
      ) : null}

      {isSegmentExportCompleted ? (
        <div className="mt-3 rounded-[20px] border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs leading-5 text-emerald-200">
          片段压缩包已就绪，可以直接下载。
        </div>
      ) : null}
    </SectionPanel>
  );
};

VideoMerge.propTypes = {
  video: PropTypes.shape({
    id: PropTypes.number,
    filename: PropTypes.string
  }),
  segments: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.number.isRequired,
      generatedUrl: PropTypes.string
    })
  ),
  mergeProgress: PropTypes.shape({
    status: PropTypes.string,
    progress: PropTypes.number,
    message: PropTypes.string,
    errorMessage: PropTypes.string,
    updatedAt: PropTypes.string
  }),
  segmentExportProgress: PropTypes.shape({
    status: PropTypes.string,
    progress: PropTypes.number,
    message: PropTypes.string,
    errorMessage: PropTypes.string,
    updatedAt: PropTypes.string
  }),
  className: PropTypes.string,
  compactMode: PropTypes.bool,
  dockMode: PropTypes.bool,
  onMerge: PropTypes.func.isRequired,
  onDownload: PropTypes.func.isRequired,
  onExportSegments: PropTypes.func.isRequired,
  onDownloadSegments: PropTypes.func.isRequired
};

export default VideoMerge;
