/**
 * 测试角色三视图集成
 * 验证前端修改后，通过完整的 API 调用生成三视图
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE_URL = 'http://localhost:5000/api';

async function testTurnaroundGeneration() {
  console.log('=== 测试角色三视图生成 ===\n');

  // 模拟前端发送的请求（与前端 buildCharacterViewPrompts 生成的格式一致）
  const requestPayload = {
    video_id: 900000001,
    resource_type: 'character',
    resource_id: 'test-character-002',
    resource_name: '测试角色（无参考图）',
    source_prompt: '一位年轻的女性角色，长发，穿着现代休闲服装\n性格气质：活泼开朗，充满活力',
    representative_frame_time: null,
    representative_frame_image_path: null,  // 测试不使用参考图
    variants: [
      {
        id: 'turnaround',
        label: '三视图',
        prompt: '20岁左右，黑色长发，身高165cm，穿着白色T恤和蓝色牛仔裤\n性格气质：活泼开朗，充满活力',
        sortOrder: 0
      }
    ]
  };

  console.log('请求参数:');
  console.log(JSON.stringify(requestPayload, null, 2));
  console.log('\n开始调用 API...\n');

  try {
    const startTime = Date.now();

    const response = await axios.post(
      `${API_BASE_URL}/resource-images/generate`,
      requestPayload,
      {
        timeout: 180000, // 3分钟超时
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`✓ API 调用成功 (耗时: ${duration}秒)\n`);
    console.log('响应数据:');
    console.log(JSON.stringify(response.data, null, 2));

    // 检查生成的图片
    if (response.data.completed_count > 0 && response.data.assets && response.data.assets.length > 0) {
      const asset = response.data.assets[0];
      const { asset_path, asset_url, status } = asset;

      console.log('\n=== 生成结果 ===');
      console.log(`图片路径: ${asset_path}`);
      console.log(`图片URL: ${asset_url}`);
      console.log(`状态: ${status}`);

      // 检查文件是否存在
      const fullPath = path.join(__dirname, '..', asset_path);
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`文件大小: ${sizeInMB} MB`);
        console.log('✓ 图片文件已成功保存');
      } else {
        console.log('✗ 图片文件不存在');
      }

      console.log('\n=== 测试通过 ===');
      console.log('角色三视图已成功生成为单张图片');
      console.log(`使用模型: ${asset.meta.model}`);
      console.log(`提供商: ${asset.meta.provider}`);
      console.log(`是否使用参考图: ${asset.meta.hasReferenceImage ? '是' : '否'}`);

    } else {
      console.log('\n✗ API 返回失败');
      console.log('错误信息:', response.data.error_summary || '未知错误');
      if (response.data.failed_count > 0) {
        console.log('失败详情:', response.data.assets[0].error_message);
      }
    }

  } catch (error) {
    console.error('\n✗ 测试失败');

    if (error.response) {
      console.error('HTTP 状态码:', error.response.status);
      console.error('错误响应:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('请求超时或无响应');
      console.error('错误信息:', error.message);
    } else {
      console.error('错误:', error.message);
    }

    process.exit(1);
  }
}

// 运行测试
testTurnaroundGeneration();
