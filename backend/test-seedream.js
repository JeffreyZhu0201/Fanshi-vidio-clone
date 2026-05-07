import env from './config/env.js';
import logger from './utils/logger.js';
import { generateCharacterTurnaround, getSeedreamProviderStatus } from './services/doubaoSeedreamService.js';

const testSeedreamIntegration = async () => {
  logger.info('Testing Doubao-Seedream integration');

  // Check provider status
  const status = getSeedreamProviderStatus();
  logger.info('Seedream provider status', status);

  if (!status.ready) {
    logger.error('Seedream provider not ready', { reason: status.reason });
    process.exit(1);
  }

  // Test character turnaround generation
  try {
    logger.info('Generating test character turnaround');

    const result = await generateCharacterTurnaround({
      characterPrompt: '一位年轻的女性角色，长发飘逸，身穿现代休闲装，微笑表情，国漫影视化风格',
      referenceImageUrl: null,
      basename: 'test-character-turnaround'
    });

    logger.info('Character turnaround generated successfully', {
      filePath: result.filePath,
      fileUrl: result.fileUrl,
      provider: result.provider,
      model: result.model
    });

    console.log('\n✅ Seedream integration test passed!');
    console.log(`Generated image: ${result.fileUrl}`);
  } catch (error) {
    logger.error('Character turnaround generation failed', {
      error: error.message,
      statusCode: error.statusCode,
      stack: error.stack
    });
    console.error('\n❌ Seedream integration test failed:', error.message);
    process.exit(1);
  }
};

testSeedreamIntegration();
