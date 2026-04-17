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
        <div className="rounded-[24px] bg-slate-950 px-4 py-4 text-white">
          <p className="text-xs uppercase tracking-[0.24em] text-white/45">当前项目</p>
          <p className="mt-2 text-sm font-semibold">{video?.filename || '未选择视频'}</p>
        </div>
        <div className="rounded-[24px] bg-brand-50 px-4 py-4">
          <p className="text-xs uppercase tracking-[0.24em] text-brand-700">片段数量</p>
          <p className="mt-2 text-xl font-bold text-ink-900">{segments.length}</p>
        </div>
        <div className="rounded-[24px] bg-accent-50 px-4 py-4">
          <p className="text-xs uppercase tracking-[0.24em] text-accent-700">已生成片段</p>
          <p className="mt-2 text-xl font-bold text-ink-900">{generatedSegments}</p>
        </div>
      </div>

      {mergeProgress.status !== 'idle' ? (
        <div className="mt-4 rounded-[26px] border border-slate-200 bg-white px-4 py-4">
          <ProgressBar
            value={mergeProgress.progress}
            status={mergeProgress.status}
            label={mergeProgress.message || '正在拼接视频'}
            startedAt={mergeProgress.updatedAt}
          />
        </div>
      ) : null}

      {mergeProgress.errorMessage ? (
        <div className="mt-4 rounded-[24px] border border-accent-100 bg-accent-50/80 px-4 py-3 text-sm text-accent-700">
          {mergeProgress.errorMessage}
        </div>
      ) : null}

      {isCompleted ? (
        <div className="mt-4 rounded-[24px] border border-emerald-100 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-700">
          拼接完成，可以直接下载成片。
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded-full bg-ink-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void onMerge()}
          disabled={!canMerge || isMerging}
        >
          {isMerging ? '拼接中...' : '开始拼接'}
        </button>
        <button
          type="button"
          className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-ink-700 transition hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
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
