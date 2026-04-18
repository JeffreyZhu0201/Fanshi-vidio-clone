import { useRef, useState } from 'react';
import PropTypes from 'prop-types';

import ProgressBar from './ProgressBar.jsx';
import SectionPanel from './SectionPanel.jsx';
import StatusBadge from './StatusBadge.jsx';
import { formatBytes } from '../utils/formatBytes.js';
import { formatDuration } from '../utils/formatDuration.js';

const UploadArea = ({
  currentVideo = null,
  videos = [],
  uploadProgress = 0,
  uploadStatus = 'idle',
  uploadError = '',
  validationMessage = '',
  uploadStartedAt = '',
  uploadLimit,
  className = '',
  compactMode = false,
  onUpload
}) => {
  const inputRef = useRef(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const handleSelectedFiles = (fileList) => {
    const file = fileList?.[0];

    if (file) {
      void onUpload(file);
    }
  };

  return (
    <SectionPanel
      eyebrow="Upload"
      title="原视频上传区"
      description={
        compactMode
          ? '拖拽或点击上传，完成后自动切到当前项目上下文。'
          : '支持拖拽上传与点击选择。上传完成后会自动把当前视频设置为工作上下文。'
      }
      actions={<StatusBadge status={uploadStatus} />}
      compact={compactMode}
      className={className}
    >
      <input
        ref={inputRef}
        type="file"
        aria-label="选择视频文件"
        accept="video/mp4,video/quicktime,video/x-msvideo,.mp4,.mov,.avi"
        className="hidden"
        onChange={(event) => {
          handleSelectedFiles(event.target.files);
          event.target.value = '';
        }}
      />

      <div className="grid gap-3">
        <div
          className={`relative rounded-[24px] border-2 border-dashed px-4 py-4 transition ${
            isDragActive
              ? 'border-brand-500/70 bg-brand-500/10 shadow-[0_16px_40px_rgba(99,102,241,0.16)]'
              : 'border-white/[0.12] bg-white/[0.04]'
          }`}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setIsDragActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragActive(false);
            handleSelectedFiles(event.dataTransfer.files);
          }}
        >
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.08fr)_minmax(260px,0.92fr)]">
            <div className="space-y-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">拖拽文件到这里，或点击按钮选择视频</p>
                  <p className="mt-1 text-xs leading-5 text-white/60">
                    支持 MP4 / MOV / AVI，单文件大小不超过 {formatBytes(uploadLimit)}
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-brand-500 to-accent-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:scale-[1.01]"
                  onClick={() => inputRef.current?.click()}
                >
                  选择视频
                </button>
              </div>

              {(uploadStatus === 'uploading' || uploadStatus === 'completed') && (
                <ProgressBar
                  value={uploadProgress}
                  status={uploadStatus === 'completed' ? 'completed' : 'uploading'}
                  label={uploadStatus === 'completed' ? '上传完成' : '正在上传原视频'}
                  startedAt={uploadStartedAt}
                />
              )}

              {validationMessage ? (
                <div className="rounded-[18px] border border-brand-500/20 bg-brand-500/10 px-3 py-2 text-xs leading-5 text-brand-100">
                  {validationMessage}
                </div>
              ) : null}

              {uploadError ? (
                <div
                  role="alert"
                  className="rounded-[18px] border border-accent-500/20 bg-accent-500/10 px-3 py-2 text-xs leading-5 text-rose-200"
                >
                  {uploadError}
                </div>
              ) : null}
            </div>

            <div className="rounded-[20px] border border-white/10 bg-black/25 px-4 py-4 text-white">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-white/40">Current Video</p>
                  <h3 className="mt-2 truncate text-sm font-semibold">
                    {currentVideo?.filename || '还没有上传视频'}
                  </h3>
                </div>
                {currentVideo ? <StatusBadge status={currentVideo.status || 'completed'} /> : null}
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">视频时长</p>
                  <p className="mt-1 text-xs font-semibold text-white">
                    {currentVideo?.duration ? formatDuration(currentVideo.duration) : '待探测'}
                  </p>
                </div>
                <div className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">最近上传数</p>
                  <p className="mt-1 text-xs font-semibold text-white">{videos.length}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {videos.length ? (
          <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.22em] text-white/45">最近上传</h3>
              <span className="text-[11px] text-white/50">{videos.length} 个视频</span>
            </div>
            <div className="grid gap-2">
              {videos.slice(0, 3).map((video) => (
                <div
                  key={video.id}
                  className="flex items-center justify-between gap-3 rounded-[16px] border border-white/10 bg-black/20 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-white">{video.filename}</p>
                    <p className="text-[11px] text-white/45">视频 ID: {video.id}</p>
                  </div>
                  <StatusBadge status={video.id === currentVideo?.id ? 'processing' : 'completed'} />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </SectionPanel>
  );
};

UploadArea.propTypes = {
  currentVideo: PropTypes.shape({
    id: PropTypes.number,
    filename: PropTypes.string,
    duration: PropTypes.number,
    status: PropTypes.string
  }),
  videos: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.number.isRequired,
      filename: PropTypes.string.isRequired
    })
  ),
  uploadProgress: PropTypes.number,
  uploadStatus: PropTypes.string,
  uploadError: PropTypes.string,
  validationMessage: PropTypes.string,
  uploadStartedAt: PropTypes.string,
  uploadLimit: PropTypes.number.isRequired,
  className: PropTypes.string,
  compactMode: PropTypes.bool,
  onUpload: PropTypes.func.isRequired
};

export default UploadArea;
