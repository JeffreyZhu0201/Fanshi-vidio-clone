import { getGeminiImageProviderStatus } from './geminiImageService.js';
import { getSeedDanceProviderStatus } from './seedDanceService.js';

const getProviderStatuses = () => {
  return {
    gemini_image: getGeminiImageProviderStatus(),
    seedance: getSeedDanceProviderStatus()
  };
};

export { getProviderStatuses };
