import { sequelize } from '../config/database.js';
import defineAnalysisModel from './Analysis.js';
import defineBackgroundAssetModel from './BackgroundAsset.js';
import defineGenerationTaskModel from './GenerationTask.js';
import defineProjectModel from './Project.js';
import defineResourceImageAssetModel from './ResourceImageAsset.js';
import defineSegmentModel from './Segment.js';
import defineShotGenerationTaskModel from './ShotGenerationTask.js';
import defineVideoModel from './Video.js';

// This module is the single export entry for all Sequelize models.
// Each model is defined once here and all associations are wired in initializeModels().
const modelRegistry = {
  Project: defineProjectModel(sequelize),
  Video: defineVideoModel(sequelize),
  Analysis: defineAnalysisModel(sequelize),
  BackgroundAsset: defineBackgroundAssetModel(sequelize),
  ResourceImageAsset: defineResourceImageAssetModel(sequelize),
  Segment: defineSegmentModel(sequelize),
  GenerationTask: defineGenerationTaskModel(sequelize),
  ShotGenerationTask: defineShotGenerationTaskModel(sequelize)
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

const { Project, Video, Analysis, BackgroundAsset, ResourceImageAsset, Segment, GenerationTask, ShotGenerationTask } =
  modelRegistry;

export {
  modelRegistry,
  initializeModels,
  Project,
  Video,
  Analysis,
  BackgroundAsset,
  ResourceImageAsset,
  Segment,
  GenerationTask,
  ShotGenerationTask
};

export default modelRegistry;
