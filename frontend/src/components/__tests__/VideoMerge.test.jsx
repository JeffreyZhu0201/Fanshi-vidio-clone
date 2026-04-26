import { fireEvent, render, screen } from '@testing-library/react';

import VideoMerge from '../VideoMerge.jsx';

describe('VideoMerge', () => {
  it('renders merge state and triggers merge/download actions', () => {
    const onMerge = jest.fn();
    const onDownload = jest.fn();
    const onExportSegments = jest.fn();
    const onDownloadSegments = jest.fn();

    render(
      <VideoMerge
        video={{ id: 1, filename: 'demo.mp4' }}
        segments={[
          { id: 1, generatedUrl: 'https://example.com/generated-1.mp4' },
          { id: 2, generatedUrl: 'https://example.com/generated-2.mp4' }
        ]}
        mergeProgress={{
          status: 'completed',
          progress: 100,
          message: 'Merge completed',
          errorMessage: '',
          updatedAt: '2026-04-16T16:00:00.000Z'
        }}
        segmentExportProgress={{
          status: 'completed',
          progress: 100,
          message: 'Segment export completed',
          errorMessage: '',
          updatedAt: '2026-04-16T16:05:00.000Z'
        }}
        onMerge={onMerge}
        onDownload={onDownload}
        onExportSegments={onExportSegments}
        onDownloadSegments={onDownloadSegments}
      />
    );

    expect(screen.getByText('成片拼接')).toBeInTheDocument();
    expect(screen.getByText('拼接完成，可以直接下载成片。')).toBeInTheDocument();
    expect(screen.getByText('片段压缩包已就绪，可以直接下载。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '开始拼接' }));
    fireEvent.click(screen.getByRole('button', { name: '下载片段压缩包' }));
    fireEvent.click(screen.getByRole('button', { name: '下载成片' }));

    expect(onMerge).toHaveBeenCalled();
    expect(onDownloadSegments).toHaveBeenCalled();
    expect(onExportSegments).not.toHaveBeenCalled();
    expect(onDownload).toHaveBeenCalled();
  });
});
