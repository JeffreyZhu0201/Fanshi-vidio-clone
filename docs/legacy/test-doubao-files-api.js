/**
 * 测试 Doubao-Seed 两步 API 工作流
 *
 * 工作流:
 * 1. 上传视频到 Doubao-Seed 云端 (Files API)
 * 2. 使用文件 ID 进行视频分析 (Responses API)
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeVideoComplete } from './services/doubaoSeedService.js';
import logger from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testDoubaoFilesAPI() {
  console.log('=== Doubao-Seed 两步 API 工作流测试 ===\n');

  // 查找测试视频文件
  const testVideoPath = path.join(__dirname, '../uploads/test-video.mp4');

  console.log(`测试视频路径: ${testVideoPath}`);
  console.log('');

  try {
    console.log('步骤 1: 上传视频到 Doubao-Seed 云端...');
    console.log('步骤 2: 使用文件 ID 进行视频分析...');
    console.log('');

    const startTime = Date.now();

    const { result, metadata } = await analyzeVideoComplete(
      testVideoPath,
      '请详细分析这个视频的内容，包括场景、人物、动作、情节等。',
      {
        fps: 0.3,
        temperature: 0.7,
        maxTokens: 16000
      }
    );

    const elapsedTime = Date.now() - startTime;

    console.log('\n=== 分析成功 ===\n');
    console.log('元数据:');
    console.log(`  - 文件名: ${metadata.fileName}`);
    console.log(`  - 文件 ID: ${metadata.fileId}`);
    console.log(`  - 模型: ${metadata.model}`);
    console.log(`  - FPS: ${metadata.fps}`);
    console.log(`  - 耗时: ${elapsedTime}ms (${(elapsedTime / 1000).toFixed(2)}s)`);
    console.log('');

    console.log('分析结果:');
    console.log(result);
    console.log('');

    // 尝试解析 JSON 结果
    try {
      const parsed = JSON.parse(result);
      console.log('结果结构:');
      console.log(`  - 场景数: ${parsed.scenes?.length || 0}`);
      console.log(`  - 角色数: ${parsed.characters?.length || 0}`);
      console.log(`  - 情节点数: ${parsed.plot_points?.length || 0}`);
    } catch (e) {
      console.log('注意: 结果不是 JSON 格式');
    }

    console.log('\n✅ 测试通过！两步 API 工作流正常工作。');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ 测试失败！\n');
    console.error('错误信息:', error.message);

    if (error.response) {
      console.error('API 响应状态:', error.response.status);
      console.error('API 响应数据:', JSON.stringify(error.response.data, null, 2));
    }

    if (error.stack) {
      console.error('\n堆栈跟踪:');
      console.error(error.stack);
    }

    process.exit(1);
  }
}

// 运行测试
testDoubaoFilesAPI();
