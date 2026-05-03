/**
 * Doubao-Seed API 链路测试脚本
 * 测试 Files API 和 Responses API 是否正常工作
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// ES modules __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 导入 doubaoSeedService
import * as doubaoSeedService from './services/doubaoSeedService.js';

async function testDoubaoSeedConnection() {
  console.log('='.repeat(60));
  console.log('Doubao-Seed API 链路测试');
  console.log('='.repeat(60));
  console.log();

  // 1. 检查提供商状态
  console.log('1️⃣  检查提供商状态...');
  try {
    const status = doubaoSeedService.getDoubaoSeedProviderStatus();
    console.log('   状态:', JSON.stringify(status, null, 2));

    if (!status.ready) {
      console.error('   ❌ Doubao-Seed 提供商不可用');
      console.error('   原因:', status.reason);
      process.exit(1);
    }
    console.log('   ✅ Doubao-Seed 提供商可用');
  } catch (error) {
    console.error('   ❌ 状态检查失败:', error.message);
    process.exit(1);
  }
  console.log();

  // 2. 查找测试视频文件
  console.log('2️⃣  查找测试视频文件...');
  const possibleVideoPaths = [
    path.join(__dirname, '../uploads/test-video.mp4'),
    path.join(__dirname, '../uploads/sample.mp4'),
    path.join(__dirname, '../public/uploads/test-video.mp4'),
  ];

  let testVideoPath = null;
  for (const videoPath of possibleVideoPaths) {
    if (fs.existsSync(videoPath)) {
      testVideoPath = videoPath;
      break;
    }
  }

  if (!testVideoPath) {
    // 尝试查找 uploads 目录中的任何视频文件
    const uploadsDir = path.join(__dirname, '../uploads');
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      const videoFile = files.find(f =>
        f.endsWith('.mp4') || f.endsWith('.mov') || f.endsWith('.avi')
      );
      if (videoFile) {
        testVideoPath = path.join(uploadsDir, videoFile);
      }
    }
  }

  if (!testVideoPath) {
    console.error('   ❌ 未找到测试视频文件');
    console.error('   请在以下位置放置测试视频:');
    possibleVideoPaths.forEach(p => console.error('   -', p));
    process.exit(1);
  }

  const stats = fs.statSync(testVideoPath);
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log('   ✅ 找到测试视频:', testVideoPath);
  console.log('   文件大小:', fileSizeMB, 'MB');

  if (stats.size > 512 * 1024 * 1024) {
    console.error('   ❌ 文件大小超过 512MB 限制');
    process.exit(1);
  }
  console.log();

  // 3. 测试视频上传 (Files API)
  console.log('3️⃣  测试视频上传 (Files API)...');
  let fileId;
  try {
    const uploadResult = await doubaoSeedService.uploadVideoToDoubaoSeed(testVideoPath);
    fileId = uploadResult.file_id;
    console.log('   ✅ 上传成功');
    console.log('   File ID:', fileId);
    console.log('   上传响应:', JSON.stringify(uploadResult, null, 2));
  } catch (error) {
    console.error('   ❌ 上传失败:', error.message);
    if (error.response) {
      console.error('   响应状态:', error.response.status);
      console.error('   响应数据:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
  console.log();

  // 4. 测试视频分析 (Responses API)
  console.log('4️⃣  测试视频分析 (Responses API)...');
  const testPrompt = `请分析这个视频，描述视频中的主要内容、场景和动作。`;

  try {
    console.log('   提示词:', testPrompt);
    console.log('   开始分析...');

    const analysisResult = await doubaoSeedService.analyzeVideoWithDoubaoSeed(
      fileId,
      testPrompt,
      {
        extractSubtitles: true,
        parseAudio: true
      }
    );

    console.log('   ✅ 分析成功');
    console.log('   分析结果:');
    console.log('   ' + '-'.repeat(58));
    console.log(analysisResult);
    console.log('   ' + '-'.repeat(58));
  } catch (error) {
    console.error('   ❌ 分析失败:', error.message);
    if (error.response) {
      console.error('   响应状态:', error.response.status);
      console.error('   响应数据:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
  console.log();

  // 5. 测试完整流程
  console.log('5️⃣  测试完整流程 (上传 + 分析)...');
  try {
    const completeResult = await doubaoSeedService.analyzeVideoComplete(
      testVideoPath,
      '请用一句话总结这个视频的内容。',
      {
        extractSubtitles: false,
        parseAudio: false
      }
    );

    console.log('   ✅ 完整流程成功');
    console.log('   结果:', completeResult);
  } catch (error) {
    console.error('   ❌ 完整流程失败:', error.message);
    process.exit(1);
  }
  console.log();

  // 测试完成
  console.log('='.repeat(60));
  console.log('✅ 所有测试通过！Doubao-Seed 链路正常');
  console.log('='.repeat(60));
}

// 运行测试
testDoubaoSeedConnection().catch(error => {
  console.error();
  console.error('='.repeat(60));
  console.error('❌ 测试失败');
  console.error('='.repeat(60));
  console.error('错误:', error.message);
  console.error('堆栈:', error.stack);
  process.exit(1);
});
