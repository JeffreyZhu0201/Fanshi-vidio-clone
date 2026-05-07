# Doubao-Seedream Integration for Character Turnaround Generation

## Overview

This document describes the integration of Doubao-Seedream API for generating character three-view (turnaround) images. The system now uses Seedream for turnaround generation while keeping Gemini for other image types.

## Implementation

### 1. New Service: doubaoSeedreamService.js

Created a new service module that handles all Seedream API interactions:

- **API Endpoint**: `https://ark.cn-beijing.volces.com/api/v3/images/generations`
- **Model**: `doubao-seedream-5-0-260128`
- **Authentication**: Bearer token (ARK API key)

#### Key Functions

- `generateCharacterTurnaround()`: Generates three-view character images with optional reference image
- `generateImageAsset()`: Generic image generation function
- `buildTurnaroundPrompt()`: Constructs specialized prompt for three-view generation
- `getSeedreamProviderStatus()`: Checks if Seedream is properly configured

#### Turnaround Prompt Template

The prompt instructs Seedream to generate three views (front, side, back) in a single image:

```
请在同一张图片中生成该角色的三视图（正面、侧面、背面），三个视角并排排列。
角色描述：${characterPrompt}

要求：
1. 三个视角必须在同一张图片中，从左到右依次为：正面视图、侧面视图（90度）、背面视图
2. 保持角色的外观、服装、发型、体态完全一致
3. 三个视角的角色大小、比例、站姿保持统一
4. 使用纯色或简洁背景，突出角色本身
5. 清晰展示角色的服装细节、配饰和特征
6. 国漫影视化风格，轮廓清晰，色彩饱和
7. 不要添加文字、标注或水印
```

### 2. Modified Service: resourceImageService.js

Updated to route turnaround generation to Seedream:

```javascript
// Use Doubao-Seedream for character turnaround generation
if (resourceType === 'character' && variantId === 'turnaround') {
  imageResult = await generateCharacterTurnaround({
    characterPrompt: variantPrompt,
    referenceImageUrl,
    basename: `${sanitizeBasenamePart(resourceType)}-${sanitizeBasenamePart(resourceId)}-${sanitizeBasenamePart(variantId)}`
  });
} else {
  // Fallback to Gemini for other types
  imageResult = await generateGeminiImageAsset({
    prompt: variantPrompt,
    basename: `${sanitizeBasenamePart(resourceType)}-${sanitizeBasenamePart(resourceId)}-${sanitizeBasenamePart(variantId)}`
  });
}
```

#### Reference Image Support

- Accepts `representativeFrameImagePath` parameter
- Converts relative path to absolute public URL using `toAbsolutePublicUploadUrl()`
- Passes reference image URL to Seedream API for style consistency

### 3. Modified Controller: resourceImageController.js

Updated to pass `representativeFrameImagePath` from request body to service:

```javascript
const result = await generateResourceImageBundle({
  videoId: Number(request.body.video_id),
  resourceType: request.body.resource_type,
  resourceId: request.body.resource_id,
  resourceName: request.body.resource_name,
  sourcePrompt: request.body.source_prompt,
  variants: request.body.variants,
  representativeFrameTime: request.body.representative_frame_time,
  representativeFrameImagePath: request.body.representative_frame_image_path  // NEW
});
```

### 4. Environment Configuration

Added new environment variables to `backend/config/env.js`:

```javascript
SEED_DREAM_API_KEY: Joi.string().allow('').default(''),
SEED_DREAM_API_BASE_URL: Joi.string().uri().allow('').default(''),
SEED_DREAM_MODEL: Joi.string().default('doubao-seedream-5-0-260128'),
SEED_DREAM_REQUEST_TIMEOUT: Joi.number().integer().positive().default(120000),
```

Added to `backend/.env`:

```bash
SEED_DREAM_API_KEY=ark-e8385177-30cd-40fb-a6e9-45c72257f49c-bd897
SEED_DREAM_API_BASE_URL=https://ark.cn-beijing.volces.com
SEED_DREAM_MODEL=doubao-seedream-5-0-260128
```

**Note**: Seedream uses the same ARK API key as Seedance since both are Volcano Engine services.

## API Request Format

### Request Body

```json
{
  "model": "doubao-seedream-5-0-260128",
  "prompt": "请在同一张图片中生成该角色的三视图...",
  "size": "2K",
  "output_format": "png",
  "watermark": false,
  "image": "http://example.com/reference-image.jpg"  // Optional reference image
}
```

### Response Format

Seedream returns images in two possible formats:

1. **Base64 encoded** (b64_json):
```json
{
  "data": [
    {
      "b64_json": "iVBORw0KGgoAAAANSUhEUgAA..."
    }
  ]
}
```

2. **URL** (url):
```json
{
  "data": [
    {
      "url": "https://example.com/generated-image.png"
    }
  ]
}
```

The service handles both formats automatically.

## Testing

### Test Script

Created `backend/test-seedream.js` to verify the integration:

```bash
cd backend
node test-seedream.js
```

The test script:
1. Checks Seedream provider status
2. Generates a test character turnaround
3. Logs the result with file path and URL

### Manual Testing

To test with a real video analysis:

1. Upload a video and run analysis
2. Select a character from the analysis results
3. Click "Generate Images" for the character
4. The turnaround variant will use Seedream with the representative frame as reference

## Error Handling

The service includes comprehensive error handling:

- **Configuration errors**: Throws if API key or base URL is missing
- **API errors**: Captures HTTP status codes and error messages
- **Response parsing errors**: Validates response structure
- **Image download errors**: Handles both base64 and URL formats

Error messages are logged with context and propagated to the frontend.

## Provider Routing Logic

| Resource Type | Variant ID | Provider |
|--------------|------------|----------|
| character    | turnaround | Doubao-Seedream |
| character    | portrait   | Gemini |
| character    | expression | Gemini |
| scene        | wide       | Gemini |
| scene        | detail     | Gemini |

## Benefits

1. **Single Image Output**: All three views in one image, easier to manage
2. **Reference Image Support**: Uses representative frame for style consistency
3. **Specialized Model**: Seedream is optimized for character design
4. **Chinese Animation Style**: Better support for 国漫影视化 aesthetic
5. **Fallback Support**: Gemini still available for other image types

## Future Enhancements

1. Add retry logic for transient API failures
2. Support additional Seedream parameters (style, aspect ratio)
3. Add caching for frequently generated turnarounds
4. Implement batch generation for multiple characters
5. Add quality validation for generated images

## Files Modified

1. `backend/services/doubaoSeedreamService.js` (NEW)
2. `backend/services/resourceImageService.js` (MODIFIED)
3. `backend/controllers/resourceImageController.js` (MODIFIED)
4. `backend/config/env.js` (MODIFIED)
5. `backend/.env` (MODIFIED)
6. `backend/test-seedream.js` (NEW)

## Dependencies

- Uses existing `externalHttpService.js` for HTTP requests
- Uses existing `fileService.js` for file operations
- No new npm packages required

## Configuration Checklist

- [x] Add SEED_DREAM_API_KEY to .env
- [x] Add SEED_DREAM_API_BASE_URL to .env
- [x] Add SEED_DREAM_MODEL to .env
- [x] Update env.js validation schema
- [x] Create doubaoSeedreamService.js
- [x] Update resourceImageService.js routing
- [x] Update resourceImageController.js parameter passing
- [ ] Restart backend server
- [ ] Test with real video analysis
- [ ] Verify generated turnaround images

## Next Steps

1. Restart the backend server to load the new code
2. Run the test script: `node backend/test-seedream.js`
3. Test with a real video analysis workflow
4. Monitor logs for any API errors
5. Verify generated images meet quality standards
