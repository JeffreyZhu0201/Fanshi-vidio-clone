<!--
 * @Author: Jeffrey Zhu JeffreyZhu0201@gmail.com
 * @Date: 2026-04-17 09:41:39
 * @LastEditors: Jeffrey Zhu JeffreyZhu0201@gmail.com
 * @LastEditTime: 2026-04-18 17:15:45
 * @FilePath: /Fanshi_vidio_clone/docs/AI_Service_API_Keys.md
 * @Description: 
 * 
 * Copyright (c) 2026 by JeffreyZhu, All Rights Reserved. 
-->


# AI接口调用

## 整体视频理解模型与视频片段理解模型

url：`https://yunwu.ai/`

model：`gemini-2.5-pro`

API 端点：

- Gemini 兼容：`POST /v1beta/models/gemini-2.5-pro:generateContent`
- OpenAI 兼容：`POST /v1/chat/completions`

key：`请在本地 .env 中填写 GEMINI_API_KEY，不要直接提交到仓库`

## 文生图模型

url：`https://yunwu.ai/`

model：`gemini-3-pro-image-preview`

API 端点：

- Gemini 兼容：`POST /v1beta/models/gemini-3-pro-image-preview:generateContent`
- OpenAI 兼容：`POST /v1/chat/completions`

key：`请在本地 .env 中填写 GEMINI_IMAGE_API_KEY，不要直接提交到仓库`

说明：

- 后端当前优先使用 `GEMINI_IMAGE_API_KEY`。
- 如果 Yunwu 返回 `无可用渠道（distributor）` 或鉴权类错误，服务会自动回退到 `GEMINI_API_KEY` 再重试一次，保证角色三视图和场景背景图链路尽量不中断。

## 多模态视频生成模型

官方文档：

- 创建视频生成任务：<https://www.volcengine.com/docs/82379/1520757?lang=zh>
- 查询视频生成任务：<https://www.volcengine.com/docs/82379/1521309?lang=zh>
- 输出视频格式与参数范围：<https://www.volcengine.com/docs/82379/1366799?lang=zh>

当前项目接入模型：`doubao-seedance-2-0-260128`

鉴权方式：

- Header 添加 `Authorization: Bearer <ARK_API_KEY>`
- `Content-Type: application/json`

推荐环境变量：

```bash
SEED_DANCE_API_KEY=YOUR_ARK_API_KEY
SEED_DANCE_API_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
SEED_DANCE_MODEL=doubao-seedance-2-0-260128
SEED_DANCE_STRICT_REMOTE=false
SEED_DANCE_POLL_INTERVAL_MS=10000
SEED_DANCE_MAX_WAIT_MS=900000
SEED_DANCE_RATIO=16:9
SEED_DANCE_DURATION_SECONDS=5
SEED_DANCE_RESOLUTION=720p
SEED_DANCE_GENERATE_AUDIO=false
SEED_DANCE_WATERMARK=false
```

说明：

- 官方创建接口：`POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks`
- 官方查询接口：`GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{task_id}`
- `Seedance 2.0 / 2.0 fast` 的 `duration` 只支持 `4~15` 的整数秒，或者传 `-1` 让模型自动决定。
- 查询任务成功后，结果视频从 `content.video_url` 读取；官方文档说明该 URL 默认约 24 小时后清理，建议及时转存。
- 查询接口的常见状态：`queued`、`running`、`cancelled`、`succeeded`、`failed`、`expired`

### 创建任务请求体

请求体核心字段：

- `model`：模型名，当前使用 `doubao-seedance-2-0-260128`
- `content`：多模态输入数组
- `ratio`：输出宽高比，例如 `16:9`
- `duration`：视频时长，整数秒
- `resolution`：例如 `720p`
- `generate_audio`：是否生成音频
- `watermark`：是否带水印

`content` 支持的项目：

- 文本提示词
- `reference_image`
- `reference_video`
- `reference_audio`

当前项目里的接法：

- 文本：使用片段最终提示词
- `reference_image`：优先带上角色三视图、场景图等资源图；无资源时可退回代表帧
- `reference_video`：至少带上原始片段视频；如存在背景资产视频，再额外附加背景参考视频
- `reference_audio`：当前链路预留支持，按需传入

## 调用示例

```bash
curl -X POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ARK_API_KEY" \
  -d '{
    "model": "doubao-seedance-2-0-260128",
    "content": [
      {
        "type": "text",
        "text": "全程使用视频1的第一视角构图，全程使用音频1作为背景音乐。第一人称视角果茶宣传广告，seedance牌「苹苹安安」苹果果茶限定款；首帧为图片1，你的手摘下一颗带晨露的阿克苏红苹果，轻脆的苹果碰撞声；2-4 秒：快速切镜，你的手将苹果块投入雪克杯，加入冰块与茶底，用力摇晃，冰块碰撞声与摇晃声卡点轻快鼓点，背景音：「鲜切现摇」；4-6 秒：第一人称成品特写，分层果茶倒入透明杯，你的手轻挤奶盖在顶部铺展，在杯身贴上粉红包标，镜头拉近看奶盖与果茶的分层纹理；6-8 秒：第一人称手持举杯，你将图片2中的果茶举到镜头前，杯身标签清晰可见，背景音「来一口鲜爽」，尾帧定格为图片2。背景声音统一为女生音色。"
      },
      {
        "type": "image_url",
        "image_url": {
          "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_tea_pic1.jpg"
        },
        "role": "reference_image"
      },
      {
        "type": "image_url",
        "image_url": {
          "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_tea_pic2.jpg"
        },
        "role": "reference_image"
      },
      {
        "type": "video_url",
        "video_url": {
          "url": "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_tea_video1.mp4"
        },
        "role": "reference_video"
      },
      {
        "type": "audio_url",
        "audio_url": {
          "url": "https://ark-project.tos-cn-beijing.volces.com/doc_audio/r2v_tea_audio1.mp3"
        },
        "role": "reference_audio"
      }
    ],
    "generate_audio": true,
    "ratio": "16:9",
    "duration": 11,
    "resolution": "720p",
    "watermark": false
  }'
```

### 查询任务示例

```bash
curl -X GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/$TASK_ID \
  -H "Authorization: Bearer YOUR_ARK_API_KEY"
```

成功时重点关注这些字段：

- `status`：应为 `succeeded`
- `duration`：最终实际视频时长
- `content.video_url`：成片下载地址
- `content.last_frame_url`：如果创建任务时开启了 `return_last_frame`，这里会返回尾帧图

## 项目内真实落地链路

后端当前已经不是 mock 规划，而是实际调用 Seedance：

- `backend/services/generationService.js`
  - 负责整理片段最终提示词
  - 自动汇总角色资源图、场景资源图、背景资产视频
  - 调用 `seedDanceService.generateSegment(...)`
- `backend/services/seedDanceService.js`
  - 创建 Seedance 任务
  - 轮询任务状态直到成功或失败
  - 下载 `content.video_url` 到本地 `uploads/outputs`
  - 当 `SEED_DANCE_STRICT_REMOTE=false` 且远端失败时，回退到本地 mock-copy

因此后续只需要在本地 `.env` 填好 `SEED_DANCE_API_KEY`，片段生成链路就会优先走 Seedance 远程生成。
