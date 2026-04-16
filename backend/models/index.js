// This module is the single export entry for all Sequelize models.
// Stage 2 will register Project, Video, Analysis, Segment and GenerationTask here.
const modelRegistry = {};

const initializeModels = () => {
  return modelRegistry;
};

export { modelRegistry, initializeModels };

