import { sequelize } from '../config/database.js';
import defineAnalysisModel from './Analysis.js';
import defineGenerationTaskModel from './GenerationTask.js';
import defineProjectModel from './Project.js';
import defineSegmentModel from './Segment.js';
import defineVideoModel from './Video.js';

// This module is the single export entry for all Sequelize models.
// Each model is defined once here and all associations are wired in initializeModels().
const modelRegistry = {
  Project: defineProjectModel(sequelize),
  Video: defineVideoModel(sequelize),
  Analysis: defineAnalysisModel(sequelize),
  Segment: defineSegmentModel(sequelize),
  GenerationTask: defineGenerationTaskModel(sequelize)
};

let isInitialized = false;

const initializeModels = () => {
  if (isInitialized) {
    return modelRegistry;
  }

  Object.values(modelRegistry).forEach((model) => {
    if (typeof model.associate === 'function') {
      model.associate(modelRegistry);
    }
  });

  isInitialized = true;
  return modelRegistry;
};

initializeModels();

const { Project, Video, Analysis, Segment, GenerationTask } = modelRegistry;

export {
  modelRegistry,
  initializeModels,
  Project,
  Video,
  Analysis,
  Segment,
  GenerationTask
};

export default modelRegistry;
