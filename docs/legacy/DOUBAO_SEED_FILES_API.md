# Doubao-Seed 两步 API 工作流集成

**实现日期**: 2026-05-02  
**工作流**: Files API (上传) + Responses API (分析)

## 概述

Doubao-Seed 使用两步 API 工作流进行视频分析：
1. **Files API**: 上传视频到云端存储，获取文件 ID
2. **Responses API**: 使用文件 ID 进行视频分析

这种方式无需配置公网 URL，视频直接上传到 Doubao-Seed 云端。

## API 工作流

### 步骤 1: 上传视频（Files API）

**端点**: `POST https://ark.cn-beijing.volces.com/api/v3/files`

**请求示例**:
```bash
curl -X POST "https://ark.cn-beijing.volces.com/api/v3/files" \
  -H "Authorization: Bearer ${SEED_DANCE_API_KEY}" \
  -F "file=@/path/to/video.mp4" \
  -F "purpose=file-extract"
```

**响应示例**:
```json
{
  "id": "file-abc123xyz",
  "object": "file",
  "bytes": 10485760,
  "created_at": 1714636800,
  "filename": "video.mp4",
  "purpose": "file-extract"
}
```

**限制**:
- 最大文件大小: 512MB
- 存储时长: 7天
- 支持格式: MP4, MOV, AVI, MKV 等

### 步骤 2: 分析视频（Responses API）

**端点**: `POST https://ark.cn-beijing.volces.com/api/v3/responses`

**请求示例**:
```bash
curl -X POST "https://ark.cn-beijing.volces.com/api/v3/responses" \
  -H "Authorization: Bearer ${SEED_DANCE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seed-2-0-lite-260215",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "video_url",
            "video_url": {
              "url": "fileid://file-abc123xyz",
              "fps": "0.3"
            }
          },
          {
            "type": "text",
            "text": "请详细分析这个视频的内容，包括场景、人物、动作等"
          }
        ]
      }
    ],
    "temperature": 0.7,
    "max_tokens": 16000
  }'
```

**响应示例**:
```json
{
  "id": "resp-xyz789",
  "object": "chat.completion",
  "created": 1714636900,
  "model": "doubao-seed-2-0-lite-260215",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "{\"scenes\": [...], \"characters\": [...], ...}"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 1500,
    "completion_tokens": 3000,
    "total_tokens": 4500
  }
}
```

**关键参数**:
- `url`: 使用 `fileid://` 协议引用已上传的文件
- `fps`: 帧采样率，字符串类型（如 "0.3" 表示每秒采样0.3帧）
- `temperature`: 生成温度，控制输出随机性
- `max_tokens`: 最大输出 token 数

## 后端实现

### doubaoSeedService.js

```javascript
// 步骤 1: 上传视频
const uploadVideoToDoubaoSeed = async (videoPath) => {
  const videoBuffer = await readFile(videoPath);
  const formData = new FormData();
  formData.append('file', videoBuffer, {
    filename: path.basename(videoPath),
    contentType: 'video/mp4'
  });
  formData.append('purpose', 'file-extract');

  const response = await axios.post(
    `${DOUBAO_SEED_API_BASE_URL}/api/v3/files`,
    formData,
    {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${env.SEED_DANCE_API_KEY}`
      },
      timeout: 300000 // 5 minutes
    }
  );

  return response.data.id; // 返回文件 ID
};

// 步骤 2: 分析视频
const analyzeVideoWithDoubaoSeed = async (fileId, prompt, options = {}) => {
  const requestBody = {
    model: DOUBAO_SEED_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'video_url',
            video_url: {
              url: `fileid://${fileId}`,
              fps: String(options.fps || 0.3)
            }
          },
          {
            type: 'text',
            text: prompt
          }
        ]
      }
    ],
    temperature: options.temperature || 0.7,
    max_tokens: options.maxTokens || 16000
  };

  const { response, responsePayload } = await requestExternalJson(
    `${DOUBAO_SEED_API_BASE_URL}/api/v3/responses`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SEED_DANCE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      timeoutMs: 600000 // 10 minutes
    }
  );

  return responsePayload.choices[0].message.content;
};

// 完整工作流
const analyzeVideoComplete = async (videoPath, prompt, options = {}) => {
  // 步骤 1: 上传
  const fileId = await uploadVideoToDoubaoSeed(videoPath);
  
  // 步骤 2: 分析
  const result = await analyzeVideoWithDoubaoSeed(fileId, prompt, options);
  
  return {
    result,
    metadata: {
      fileName: path.basename(videoPath),
      fileId,
      model: DOUBAO_SEED_MODEL,
      fps: options.fps || 0.3
    }
  };
};
```

## 环境配置

### 必需环境变量

```bash
# Doubao-Seed API 密钥（与 Seedance 共用）
SEED_DANCE_API_KEY=ark-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# API 基础 URL（可选，默认值如下）
SEED_DANCE_API_BASE_URL=https://ark.cn-beijing.volces.com
```

### 可选环境变量

```bash
# 严格模式（禁用 mock 回退）
SEED_DANCE_STRICT_REMOTE=false
```

**注意**: 使用两步 API 工作流时，**不需要**配置 `PUBLIC_ASSET_BASE_URL`，因为视频会直接上传到 Doubao-Seed 云端存储。

## 优势与限制

### 优势

1. **无需公网 URL**: 视频直接上传到云端，无需配置公网访问
2. **简化部署**: 不需要配置 SSL 证书、域名、frp 隧道等
3. **安全性**: 视频不需要暴露在公网
4. **稳定性**: 不依赖本地网络环境

### 限制

1. **文件大小**: 最大 512MB
2. **存储时长**: 上传的文件仅保存 7 天
3. **上传时间**: 大文件上传可能需要较长时间
4. **网络要求**: 需要稳定的上传带宽

## 与 Chat Completions API 的对比

| 特性 | Files API + Responses API | Chat Completions API |
|------|---------------------------|----------------------|
| 工作流 | 两步（上传 + 分析） | 单步（直接分析） |
| 视频位置 | 云端存储 | 公网 URL |
| 配置复杂度 | 低（仅需 API key） | 高（需要公网 URL、SSL 等） |
| 文件大小限制 | 512MB | 取决于服务器配置 |
| 存储时长 | 7 天 | 永久（本地存储） |
| FPS 参数 | 字符串（"0.3"） | 数字（5） |
| 时序感知 | 基础 | 增强 |
| 适用场景 | 开发/测试环境 | 生产环境 |

## 故障排查

### 上传失败

**错误**: `413 Payload Too Large`
- **原因**: 视频文件超过 512MB
- **解决**: 压缩视频或使用较低分辨率

**错误**: `timeout of 300000ms exceeded`
- **原因**: 网络上传速度慢
- **解决**: 增加 timeout 配置或优化网络环境

### 分析失败

**错误**: `Invalid file_id`
- **原因**: 文件 ID 不存在或已过期（7天）
- **解决**: 重新上传视频

**错误**: `fps must be a string`
- **原因**: fps 参数类型错误
- **解决**: 确保 fps 使用 `String()` 转换为字符串

## 测试

### 单元测试

```bash
cd backend
npm test -- doubaoSeedService.test.js
```

### 集成测试

```bash
# 测试完整工作流
node backend/test-doubao-seed.js
```

## 迁移指南

### 从 Chat Completions API 迁移

如果之前使用 Chat Completions API（直接传递 URL），迁移步骤：

1. **更新 doubaoSeedService.js**:
   - 添加 `uploadVideoToDoubaoSeed()` 函数
   - 修改 `analyzeVideoWithDoubaoSeed()` 使用 `fileid://` 协议
   - 更新 `analyzeVideoComplete()` 调用上传步骤

2. **移除环境变量**:
   - 不再需要 `PUBLIC_ASSET_BASE_URL`
   - 不再需要 `SEED_DANCE_PUBLIC_ASSET_BASE_URL`

3. **更新 FPS 参数**:
   - 从数字类型改为字符串类型
   - 从 5 改为 0.3（默认值）

4. **测试验证**:
   - 运行单元测试
   - 测试完整的上传→分析流程

## 参考资料

- [Doubao-Seed API 文档](https://www.volcengine.com/docs/82379/1298454)
- [Files API 参考](https://www.volcengine.com/docs/82379/1298455)
- [Responses API 参考](https://www.volcengine.com/docs/82379/1298456)
