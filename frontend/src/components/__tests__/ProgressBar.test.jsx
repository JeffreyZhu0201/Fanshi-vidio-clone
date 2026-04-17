import { render, screen } from '@testing-library/react';

import ProgressBar from '../ProgressBar.jsx';

describe('ProgressBar', () => {
  test('renders percentage and completion status text', () => {
    render(
      <ProgressBar
        value={100}
        status="completed"
        label="拼接进度"
      />
    );

    expect(screen.getByText('拼接进度')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('任务已完成')).toBeInTheDocument();
  });
});
