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
      description="支持拖拽上传与点击选择。上传完成后会自动把当前视频设置为工作上下文。"
      actions={<StatusBadge status={uploadStatus} />}
    >
      <div
        className={`relative rounded-[28px] border-2 border-dashed px-5 py-6 transition ${
          isDragActive
            ? 'border-brand-500 bg-brand-50/90 shadow-[0_20px_50px_rgba(99,102,241,0.12)]'
            : 'border-slate-200 bg-slate-50/80'
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

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-ink-900">拖拽文件到这里，或点击按钮选择视频</p>
              <p className="mt-1 text-xs leading-5 text-ink-500">
                支持 MP4 / MOV / AVI，单文件大小不超过 {formatBytes(uploadLimit)}
              </p>
            </div>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full bg-ink-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-ink-700"
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
            <div className="rounded-2xl border border-brand-100 bg-brand-50/80 px-4 py-3 text-sm text-brand-800">
              {validationMessage}
            </div>
          ) : null}

          {uploadError ? (
            <div className="rounded-2xl border border-accent-100 bg-accent-50/80 px-4 py-3 text-sm text-accent-700">
              {uploadError}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div className="rounded-[26px] bg-slate-950 px-5 py-5 text-white">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-white/45">Current Video</p>
              <h3 className="mt-2 text-lg font-semibold">
                {currentVideo?.filename || '还没有上传视频'}
              </h3>
            </div>
            {currentVideo ? <StatusBadge status={currentVideo.status || 'completed'} /> : null}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-white/10 px-4 py-3">
              <p className="text-xs text-white/55">视频时长</p>
              <p className="mt-1 text-sm font-medium">
                {currentVideo?.duration ? formatDuration(currentVideo.duration) : '待探测'}
              </p>
            </div>
            <div className="rounded-2xl bg-white/10 px-4 py-3">
              <p className="text-xs text-white/55">最近上传数</p>
              <p className="mt-1 text-sm font-medium">{videos.length}</p>
            </div>
          </div>
        </div>

        {videos.length ? (
          <div className="rounded-[26px] border border-slate-200 bg-white/75 px-4 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink-900">最近上传</h3>
              <span className="text-xs text-ink-500">{videos.length} 个视频</span>
            </div>
            <div className="space-y-2">
              {videos.slice(0, 3).map((video) => (
                <div
                  key={video.id}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">{video.filename}</p>
                    <p className="text-xs text-ink-500">视频 ID: {video.id}</p>
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
  onUpload: PropTypes.func.isRequired
};

export default UploadArea;
