import { fireEvent, render, screen } from '@testing-library/react';

import UploadArea from '../UploadArea.jsx';

describe('UploadArea', () => {
  it('calls onUpload when a valid file is selected', () => {
    const onUpload = jest.fn();

    render(
      <UploadArea
        currentVideo={null}
        videos={[]}
        uploadProgress={0}
        uploadStatus="idle"
        uploadError=""
        validationMessage=""
        uploadStartedAt=""
        uploadLimit={524288000}
        onUpload={onUpload}
      />
    );

    const input = screen.getByLabelText('选择视频文件');
    const file = new File(['demo'], 'demo.mp4', { type: 'video/mp4' });

    fireEvent.change(input, {
      target: {
        files: [file]
      }
    });

    expect(onUpload).toHaveBeenCalledWith(file);
  });

  it('renders upload state feedback', () => {
    render(
      <UploadArea
        currentVideo={{ id: 1, filename: 'demo.mp4', duration: 12, status: 'uploaded' }}
        videos={[{ id: 1, filename: 'demo.mp4' }]}
        uploadProgress={100}
        uploadStatus="completed"
        uploadError=""
        validationMessage="上传完成"
        uploadStartedAt="2026-04-16T16:00:00.000Z"
        uploadLimit={524288000}
        onUpload={jest.fn()}
      />
    );

    expect(screen.getAllByText('上传完成').length).toBeGreaterThan(0);
    expect(screen.getAllByText('demo.mp4').length).toBeGreaterThan(0);
  });
});
