import swaggerJsdoc from 'swagger-jsdoc';

import env from './env.js';

const serverUrl = env.HTTPS_ENABLED
  ? `https://localhost:${env.HTTPS_PORT}${env.HTTP_REDIRECT_TO_HTTPS ? '' : ''}`
  : `http://localhost:${env.PORT}`;

const definition = {
  openapi: '3.0.3',
  info: {
    title: 'Fanshi Video Clone Backend API',
    version: '0.1.0',
    description: 'REST API for video upload, analysis, segmentation, generation and merge workflows.'
  },
  servers: [
    {
      url: serverUrl,
      description: 'Local development server'
    }
  ],
  components: {
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: false
          },
          message: {
            type: 'string',
            example: 'Request validation failed'
          },
          details: {
            nullable: true
          }
        }
      },
      Video: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          filename: { type: 'string', example: 'demo.mp4' },
          duration: { type: 'integer', nullable: true, example: 18 },
          status: { type: 'string', example: 'uploaded' },
          project_id: { type: 'integer', example: 1 },
          file_path: { type: 'string', example: 'videos/171234-demo.mp4' },
          file_url: { type: 'string', example: '/uploads/videos/171234-demo.mp4' }
        }
      },
      Analysis: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          video_id: { type: 'integer', example: 1 },
          status: { type: 'string', example: 'completed' },
          plot: { type: 'string' },
          characters: { type: 'array', items: { type: 'object' } },
          backgrounds: { type: 'array', items: { type: 'object' } },
          time_anchors: { type: 'array', items: { type: 'object' } }
        }
      },
      Segment: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          segment_index: { type: 'integer', example: 0 },
          start_time: { type: 'number', example: 0 },
          end_time: { type: 'number', example: 4.5 },
          file_path: { type: 'string', example: 'segments/demo-segment-0.mp4' },
          file_url: { type: 'string', example: '/uploads/segments/demo-segment-0.mp4' },
          analysis: { type: 'object' }
        }
      },
      TaskProgress: {
        type: 'object',
        properties: {
          task_id: { type: 'string', example: '877f7f2c-cc3d-4b51-b8f0-3e98c6c6ae44' },
          type: { type: 'string', example: 'split' },
          status: { type: 'string', example: 'processing' },
          progress: { type: 'integer', example: 60 },
          message: { type: 'string', example: 'Analyzing video segments' },
          meta: {
            type: 'object'
          },
          result: {
            nullable: true
          },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
        }
      },
      GenerationTaskStatus: {
        type: 'object',
        properties: {
          task_id: { type: 'integer', example: 1001 },
          segment_id: { type: 'integer', example: 42 },
          status: { type: 'string', example: 'completed' },
          progress: { type: 'integer', example: 100 },
          prompt: { type: 'string', example: '@主角 在室内场景中继续推进剧情' },
          optimized_prompt: { type: 'string', nullable: true },
          result_url: { type: 'string', nullable: true, example: '/uploads/outputs/segment-42.mp4' },
          error_message: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
        }
      }
    }
  },
  paths: {
    '/api/videos/upload': {
      post: {
        summary: 'Upload a source video',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  video: {
                    type: 'string',
                    format: 'binary'
                  },
                  project_id: {
                    type: 'integer'
                  },
                  project_name: {
                    type: 'string'
                  }
                },
                required: ['video']
              }
            }
          }
        },
        responses: {
          201: {
            description: 'Uploaded successfully',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Video'
                }
              }
            }
          }
        }
      }
    },
    '/api/videos/{id}': {
      get: {
        summary: 'Get video detail',
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'integer' }
          }
        ],
        responses: {
          200: {
            description: 'Video found'
          }
        }
      },
      delete: {
        summary: 'Delete a video and related files',
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'integer' }
          }
        ],
        responses: {
          200: {
            description: 'Deleted'
          }
        }
      }
    },
    '/api/analysis/analyze': {
      post: {
        summary: 'Analyze a full video with Gemini service or local mock',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  video_id: { type: 'integer' }
                },
                required: ['video_id']
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Analysis completed',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Analysis'
                }
              }
            }
          }
        }
      }
    },
    '/api/analysis/{videoId}': {
      get: {
        summary: 'Get full video analysis',
        parameters: [
          {
            in: 'path',
            name: 'videoId',
            required: true,
            schema: { type: 'integer' }
          }
        ],
        responses: {
          200: {
            description: 'Analysis found'
          }
        }
      }
    },
    '/api/analysis/optimize-prompt': {
      post: {
        summary: 'Optimize a generation prompt and highlight @character mentions',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  prompt: { type: 'string' },
                  characters: {
                    type: 'array',
                    items: { type: 'object' }
                  }
                },
                required: ['prompt']
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Prompt optimized'
          }
        }
      }
    },
    '/api/segments/split': {
      post: {
        summary: 'Split a video by time anchors',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  video_id: { type: 'integer' },
                  time_anchors: {
                    type: 'array',
                    items: { type: 'object' }
                  }
                },
                required: ['video_id']
              }
            }
          }
        },
        responses: {
          202: {
            description: 'Split task queued',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/TaskProgress'
                }
              }
            }
          }
        }
      }
    },
    '/api/segments/{videoId}': {
      get: {
        summary: 'List all segments for a video',
        parameters: [
          {
            in: 'path',
            name: 'videoId',
            required: true,
            schema: { type: 'integer' }
          }
        ],
        responses: {
          200: {
            description: 'Segment list',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    $ref: '#/components/schemas/Segment'
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/generation/generate': {
      post: {
        summary: 'Generate a new segment version',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  segment_id: { type: 'integer' },
                  prompt: { type: 'string' }
                },
                required: ['segment_id', 'prompt']
              }
            }
          }
        },
        responses: {
          202: {
            description: 'Generation task queued'
          }
        }
      }
    },
    '/api/generation/{taskId}': {
      get: {
        summary: 'Get generation task status',
        parameters: [
          {
            in: 'path',
            name: 'taskId',
            required: true,
            schema: { type: 'integer' }
          }
        ],
        responses: {
          200: {
            description: 'Generation task status',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/GenerationTaskStatus'
                }
              }
            }
          }
        }
      }
    },
    '/api/merge/start': {
      post: {
        summary: 'Start merged video export',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  video_id: { type: 'integer' }
                },
                required: ['video_id']
              }
            }
          }
        },
        responses: {
          202: {
            description: 'Merge task queued'
          }
        }
      }
    },
    '/api/tasks/{taskId}': {
      get: {
        summary: 'Get in-memory async task status for split or merge jobs',
        parameters: [
          {
            in: 'path',
            name: 'taskId',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          200: {
            description: 'Task progress payload',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/TaskProgress'
                }
              }
            }
          }
        }
      }
    },
    '/api/merge/{taskId}/progress': {
      get: {
        summary: 'Get merge task progress',
        parameters: [
          {
            in: 'path',
            name: 'taskId',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          200: {
            description: 'Progress returned'
          }
        }
      }
    },
    '/api/merge/{taskId}/download': {
      get: {
        summary: 'Download merged video file',
        parameters: [
          {
            in: 'path',
            name: 'taskId',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          200: {
            description: 'Binary file stream'
          }
        }
      }
    }
  }
};

const swaggerSpec = swaggerJsdoc({
  definition,
  apis: []
});

export default swaggerSpec;
