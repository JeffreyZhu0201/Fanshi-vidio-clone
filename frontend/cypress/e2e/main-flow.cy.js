const buildAnalysisPayload = () => ({
  id: 501,
  video_id: 101,
  status: 'completed',
  plot: '一位主角进入室内空间，完成一段连续动作。',
  characters: [
    {
      id: 'character_main',
      name: '主角',
      appearancePrompt: '年轻主角，电影感光线，服装利落'
    }
  ],
  backgrounds: [
    { id: 'bg_1', description: '暖色室内场景，光线从侧面落下。' },
    { id: 'bg_2', description: '镜头推进到角色近景，环境细节清晰。' }
  ],
  time_anchors: [
    { startTime: 0, endTime: 4, sceneSummary: '主角进入场景' },
    { startTime: 4, endTime: 8, sceneSummary: '主角完成主要动作' }
  ]
});

const buildSegmentsPayload = () => [
  {
    id: 601,
    segment_index: 0,
    start_time: 0,
    end_time: 4,
    file_path: 'segments/demo-0.mp4',
    file_url: '/uploads/segments/demo-0.mp4',
    analysis: {
      scene: '主角进入场景',
      action: '主角向前走动',
      prompt: '@主角 在电影感空间内推进剧情，镜头稳定。'
    },
    latest_generation_task: null
  },
  {
    id: 602,
    segment_index: 1,
    start_time: 4,
    end_time: 8,
    file_path: 'segments/demo-1.mp4',
    file_url: '/uploads/segments/demo-1.mp4',
    analysis: {
      scene: '主角完成动作',
      action: '主角完成关键动作',
      prompt: '@主角 保持角色设定，完成关键动作。'
    },
    latest_generation_task: null
  }
];

describe('Fanshi stage 5 main flow', () => {
  it('uploads, analyzes, edits, generates, merges and downloads in one flow', () => {
    let splitPollCount = 0;
    let generationPollCount = 0;
    let mergePollCount = 0;

    cy.intercept('GET', '**/api/health', {
      statusCode: 200,
      body: {
        success: true,
        service: 'backend',
        status: 'ok',
        database: {
          connected: true
        },
        timestamp: '2026-01-01T00:00:00.000Z'
      }
    }).as('health');

    cy.intercept('POST', '**/api/videos/upload', {
      statusCode: 201,
      body: {
        id: 101,
        filename: 'demo.mp4',
        duration: 8,
        status: 'uploaded',
        project_id: 1,
        file_path: 'videos/demo.mp4',
        file_url: '/uploads/videos/demo.mp4',
        file_size: 2048
      }
    }).as('uploadVideo');

    cy.intercept('GET', '**/api/analysis/101', {
      statusCode: 404,
      body: {
        success: false,
        message: 'Analysis not found.'
      }
    }).as('getInitialAnalysis');

    cy.intercept('GET', '**/uploads/**', {
      statusCode: 200,
      headers: {
        'content-type': 'video/mp4'
      },
      body: 'video-binary'
    }).as('assetRequest');

    cy.intercept('GET', '**/api/segments/101', (request) => {
      request.reply({
        statusCode: 200,
        body: splitPollCount > 1 ? buildSegmentsPayload() : []
      });
    }).as('getSegments');

    cy.intercept('POST', '**/api/analysis/analyze', {
      statusCode: 200,
      body: buildAnalysisPayload()
    }).as('analyzeVideo');

    cy.intercept('POST', '**/api/segments/split', {
      statusCode: 202,
      body: {
        task_id: 'split-task-001',
        status: 'pending',
        progress: 0
      }
    }).as('splitVideo');

    cy.intercept('GET', '**/api/tasks/split-task-001', (request) => {
      splitPollCount += 1;

      request.reply({
        statusCode: 200,
        body:
          splitPollCount === 1
            ? {
                task_id: 'split-task-001',
                type: 'split',
                status: 'processing',
                progress: 60,
                message: '正在切分片段'
              }
            : {
                task_id: 'split-task-001',
                type: 'split',
                status: 'completed',
                progress: 100,
                message: 'Video split completed'
              }
      });
    }).as('splitTask');

    cy.intercept('POST', '**/api/analysis/optimize-prompt', {
      statusCode: 200,
      body: {
        optimized_prompt: '@主角 在电影感空间内推进剧情，镜头更稳定，动作更明确。',
        highlighted_prompt:
          '<span class="mention text-blue-500">@主角</span> 在电影感空间内推进剧情，镜头更稳定，动作更明确。'
      }
    }).as('optimizePrompt');

    cy.intercept('POST', '**/api/generation/generate', {
      statusCode: 202,
      body: {
        task_id: 701,
        status: 'pending',
        progress: 0
      }
    }).as('generateSegment');

    cy.intercept('GET', '**/api/generation/701', (request) => {
      generationPollCount += 1;

      request.reply({
        statusCode: 200,
        body:
          generationPollCount === 1
            ? {
                task_id: 701,
                segment_id: 601,
                status: 'processing',
                progress: 45,
                prompt: '@主角 在电影感空间内推进剧情，镜头更稳定，动作更明确。',
                optimized_prompt: '电影化提示词',
                result_url: '',
                error_message: null
              }
            : {
                task_id: 701,
                segment_id: 601,
                status: 'completed',
                progress: 100,
                prompt: '@主角 在电影感空间内推进剧情，镜头更稳定，动作更明确。',
                optimized_prompt: '电影化提示词',
                result_url: '/uploads/outputs/generated-0.mp4',
                error_message: null
              }
      });
    }).as('generationTask');

    cy.intercept('POST', '**/api/merge/start', {
      statusCode: 202,
      body: {
        task_id: 'merge-task-001',
        status: 'pending'
      }
    }).as('mergeVideo');

    cy.intercept('GET', '**/api/merge/merge-task-001/progress', (request) => {
      mergePollCount += 1;

      request.reply({
        statusCode: 200,
        body:
          mergePollCount === 1
            ? {
                status: 'processing',
                progress: 50,
                message: '正在拼接视频'
              }
            : {
                status: 'completed',
                progress: 100,
                message: 'Merge completed'
              }
      });
    }).as('mergeProgress');

    cy.intercept('GET', '**/api/merge/merge-task-001/download', {
      statusCode: 200,
      headers: {
        'content-type': 'video/mp4',
        'content-disposition': 'attachment; filename="fanshi-output.mp4"'
      },
      body: 'merged-video'
    }).as('downloadVideo');

    cy.visit('/');
    cy.wait('@health');

    cy.get('input[type="file"]').selectFile(
      {
        contents: Cypress.Buffer.from('fake-video-content'),
        fileName: 'demo.mp4',
        mimeType: 'video/mp4'
      },
      { force: true }
    );

    cy.wait('@uploadVideo');
    cy.contains('上传完成').should('be.visible');
    cy.contains('开始分析').click();

    cy.wait('@analyzeVideo');
    cy.contains('剧情摘要').should('be.visible');
    cy.contains('生成片段').click();

    cy.wait('@splitVideo');
    cy.wait('@splitTask');
    cy.wait('@splitTask');
    cy.wait('@getSegments');
    cy.contains('Segment 01').should('be.visible');

    cy.contains('article', 'Segment 01').within(() => {
      cy.contains('button', '优化提示词').click();
    });
    cy.wait('@optimizePrompt');
    cy.contains('已同步后端高亮结果').should('be.visible');

    cy.contains('article', 'Segment 01').within(() => {
      cy.contains('button', '生成片段').click();
    });
    cy.wait('@generateSegment');
    cy.wait('@generationTask');
    cy.wait('@generationTask');
    cy.contains('片段生成完成').should('be.visible');

    cy.contains('开始拼接').click();
    cy.wait('@mergeVideo');
    cy.wait('@mergeProgress');
    cy.wait('@mergeProgress');
    cy.contains('拼接完成，可以直接下载成片。').should('be.visible');

    cy.contains('下载成片').click();
    cy.wait('@downloadVideo');
  });

  it('shows validation and server-side errors for edge cases', () => {
    cy.intercept('GET', '**/api/health', {
      statusCode: 200,
      body: {
        success: true,
        service: 'backend',
        status: 'ok',
        database: {
          connected: true
        },
        timestamp: '2026-01-01T00:00:00.000Z'
      }
    });

    cy.intercept('POST', '**/api/videos/upload', {
      statusCode: 500,
      body: {
        success: false,
        message: 'Upload failed'
      }
    }).as('uploadFailure');

    cy.visit('/');

    cy.get('input[type="file"]').selectFile(
      {
        contents: Cypress.Buffer.from('plain-text'),
        fileName: 'invalid.txt',
        mimeType: 'text/plain'
      },
      { force: true }
    );

    cy.contains('仅支持 MP4、MOV、AVI 视频文件。').should('be.visible');
    cy.get('input[type="file"]').selectFile(
      {
        contents: Cypress.Buffer.from('fake-video-content'),
        fileName: 'demo.mp4',
        mimeType: 'video/mp4'
      },
      { force: true }
    );
    cy.wait('@uploadFailure');
    cy.contains('上传失败，请稍后重试。').should('be.visible');
  });
});
