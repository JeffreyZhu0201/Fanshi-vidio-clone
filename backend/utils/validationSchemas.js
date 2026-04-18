import Joi from 'joi';

const idParamSchema = Joi.object({
  id: Joi.number().integer().positive().required()
});

const videoIdParamSchema = Joi.object({
  videoId: Joi.number().integer().positive().required()
});

const taskIdParamSchema = Joi.object({
  taskId: Joi.string().trim().min(10).required()
});

const generationTaskIdParamSchema = Joi.object({
  taskId: Joi.number().integer().positive().required()
});

const uploadVideoBodySchema = Joi.object({
  project_id: Joi.number().integer().positive(),
  project_name: Joi.string().trim().max(255).allow('')
});

const analyzeVideoBodySchema = Joi.object({
  video_id: Joi.number().integer().positive().required()
});

const optimizePromptBodySchema = Joi.object({
  prompt: Joi.string().trim().min(1).required(),
  mode: Joi.string().trim().valid('generation', 'character_resource', 'scene_resource').default('generation'),
  characters: Joi.array()
    .items(
      Joi.alternatives().try(
        Joi.string().trim().min(1),
        Joi.object({
          id: Joi.string().trim().allow(''),
          name: Joi.string().trim().required(),
          appearancePrompt: Joi.string().trim().allow(''),
          appearance_prompt: Joi.string().trim().allow(''),
          personalityPrompt: Joi.string().trim().allow(''),
          personality_prompt: Joi.string().trim().allow(''),
          temperament: Joi.string().trim().allow(''),
          personality: Joi.string().trim().allow(''),
          traits: Joi.string().trim().allow('')
        })
      )
    )
    .default([]),
  backgrounds: Joi.array()
    .items(
      Joi.alternatives().try(
        Joi.string().trim().min(1),
        Joi.object({
          id: Joi.string().trim().allow(''),
          name: Joi.string().trim().allow(''),
          title: Joi.string().trim().allow(''),
          sceneName: Joi.string().trim().allow(''),
          scene_name: Joi.string().trim().allow(''),
          scenePrompt: Joi.string().trim().allow(''),
          scene_prompt: Joi.string().trim().allow(''),
          backgroundPrompt: Joi.string().trim().allow(''),
          background_prompt: Joi.string().trim().allow(''),
          description: Joi.string().trim().allow(''),
          summary: Joi.string().trim().allow('')
        })
      )
    )
    .default([])
});

const timeAnchorSchema = Joi.object({
  startTime: Joi.number().min(0),
  endTime: Joi.number(),
  sceneSummary: Joi.string().trim().allow(''),
  scenePrompt: Joi.string().trim().allow(''),
  representativeFrameTime: Joi.number().min(0).allow(null),
  representativeFrameNote: Joi.string().trim().allow(''),
  start_time: Joi.number().min(0),
  end_time: Joi.number(),
  scene_summary: Joi.string().trim().allow(''),
  scene_prompt: Joi.string().trim().allow(''),
  representative_frame_time: Joi.number().min(0).allow(null),
  representative_frame_note: Joi.string().trim().allow('')
}).custom((value, helpers) => {
  const start = value.startTime ?? value.start_time;
  const end = value.endTime ?? value.end_time;

  if (typeof start !== 'number' || Number.isNaN(start)) {
    return helpers.error('any.invalid', {
      message: 'startTime/start_time is required.'
    });
  }

  if (typeof end !== 'number' || Number.isNaN(end) || end <= start) {
    return helpers.error('any.invalid', {
      message: 'endTime/end_time must be greater than startTime/start_time.'
    });
  }

  return value;
}).unknown(true);

const splitVideoBodySchema = Joi.object({
  video_id: Joi.number().integer().positive().required(),
  time_anchors: Joi.array().items(timeAnchorSchema).min(1)
});

const generateSegmentBodySchema = Joi.object({
  segment_id: Joi.number().integer().positive().required(),
  prompt: Joi.string().trim().min(1).required()
});

const mergeStartBodySchema = Joi.object({
  video_id: Joi.number().integer().positive().required()
});

const monitoringEventBodySchema = Joi.object({
  type: Joi.string().trim().max(64).required(),
  payload: Joi.object().unknown(true).default({}),
  url: Joi.string().uri().allow('').default(''),
  userAgent: Joi.string().trim().max(1024).allow('').default(''),
  recordedAt: Joi.string().isoDate().required()
});

export {
  idParamSchema,
  videoIdParamSchema,
  taskIdParamSchema,
  generationTaskIdParamSchema,
  uploadVideoBodySchema,
  analyzeVideoBodySchema,
  optimizePromptBodySchema,
  splitVideoBodySchema,
  generateSegmentBodySchema,
  mergeStartBodySchema,
  monitoringEventBodySchema
};
