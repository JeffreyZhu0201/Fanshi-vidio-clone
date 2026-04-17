import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import PromptEditor from '../PromptEditor.jsx';

describe('PromptEditor', () => {
  it('updates text and supports undo/redo', () => {
    const onAnalyze = jest.fn();
    const onOptimize = jest.fn();
    const observedChanges = [];

    const ControlledPromptEditor = () => {
      const [value, setValue] = useState('@主角 走进室内');

      return (
        <PromptEditor
          value={value}
          onChange={(nextValue) => {
            observedChanges.push(nextValue);
            setValue(nextValue);
          }}
          onAnalyze={onAnalyze}
          onOptimize={onOptimize}
          isAnalyzing={false}
          isOptimizing={false}
          disabled={false}
          highlightedPrompt=""
        />
      );
    };

    render(<ControlledPromptEditor />);

    const textarea = screen.getByPlaceholderText(
      '在这里编辑片段提示词，使用 @角色名 来保持人物设定一致。'
    );

    fireEvent.change(textarea, {
      target: {
        value: '@主角 走进室内并坐下'
      }
    });

    expect(observedChanges.at(-1)).toBe('@主角 走进室内并坐下');
    expect(screen.getByText('@主角')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(observedChanges.at(-1)).toBe('@主角 走进室内');

    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(observedChanges.at(-1)).toBe('@主角 走进室内并坐下');

    fireEvent.click(screen.getByRole('button', { name: '片段分析' }));
    fireEvent.click(screen.getByRole('button', { name: '优化提示词' }));
    expect(onAnalyze).toHaveBeenCalledWith('@主角 走进室内并坐下');
    expect(onOptimize).toHaveBeenCalledWith('@主角 走进室内并坐下');
  });
});
