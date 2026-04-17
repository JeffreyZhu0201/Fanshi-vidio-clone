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
  onMerge,
  onDownload
}) => {
  const generatedSegments = segments.filter((segment) => segment.generatedUrl).length;
  const canMerge = Boolean(video?.id) && segments.length > 0;
  const isMerging = mergeProgress.status === 'processing' || mergeProgress.status === 'pending';
  const isCompleted = mergeProgress.status === 'completed';

  return (
    <SectionPanel
      eyebrow="Merge"
      title="成片拼接"
      description="拼接任务会优先使用已生成的片段，没有生成结果的片段会自动回退到原片内容。"
      actions={<StatusBadge status={mergeProgress.status} />}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-[24px] border border-white/10 bg-black/25 px-4 py-4 text-white">
          <p className="text-xs uppercase tracking-[0.24em] text-white/40">当前项目</p>
          <p className="mt-2 text-sm font-semibold">{video?.filename || '未选择视频'}</p>
        </div>
        <div className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
          <p className="text-xs uppercase tracking-[0.24em] text-white/50">片段数量</p>
          <p className="mt-2 text-xl font-bold text-white">{segments.length}</p>
        </div>
        <div className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
          <p className="text-xs uppercase tracking-[0.24em] text-white/50">已生成片段</p>
          <p className="mt-2 text-xl font-bold text-white">{generatedSegments}</p>
        </div>
      </div>

      {mergeProgress.status !== 'idle' ? (
        <div className="mt-4 rounded-[26px] border border-white/10 bg-white/[0.04] px-4 py-4">
          <ProgressBar
            value={mergeProgress.progress}
            status={mergeProgress.status}
            label={mergeProgress.message || '正在拼接视频'}
            startedAt={mergeProgress.updatedAt}
          />
        </div>
      ) : null}

      {mergeProgress.errorMessage ? (
        <div
          role="alert"
          className="mt-4 rounded-[24px] border border-accent-500/20 bg-accent-500/10 px-4 py-3 text-sm text-rose-200"
        >
          {mergeProgress.errorMessage}
        </div>
      ) : null}

      {isCompleted ? (
        <div className="mt-4 rounded-[24px] border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          拼接完成，可以直接下载成片。
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded-full bg-gradient-to-r from-brand-500 to-accent-500 px-5 py-3 text-sm font-semibold text-white transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void onMerge()}
          disabled={!canMerge || isMerging}
        >
          {isMerging ? '拼接中...' : '开始拼接'}
        </button>
        <button
          type="button"
          className="rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => void onDownload()}
          disabled={!isCompleted}
        >
          下载成片
        </button>
      </div>
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
  onMerge: PropTypes.func.isRequired,
  onDownload: PropTypes.func.isRequired
};

export default VideoMerge;
