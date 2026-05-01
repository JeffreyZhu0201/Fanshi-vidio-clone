# Full Video Generation Design

**Date:** 2026-05-01  
**Status:** Approved  
**Author:** Claude (Brainstorming Session)

## Overview

This design document describes the refactoring of the video generation pipeline from a "shot-by-shot generation + assembly" approach to a "full video generation with concatenated prompts" approach.

### Current Flow (To Be Replaced)

```
Upload → Analysis → Split into shots → Generate each shot individually → Assemble shots → Final video
```

### New Flow

```
Upload → Analysis → Generate reference assets → Concatenate all shot prompts → Generate full video in one call
```

## Motivation

The current approach generates each shot separately and then uses FFmpeg to merge them, which:
- Requires multiple Seedance API calls (one per shot)
- Introduces potential inconsistencies between shots
- Requires complex assembly logic with audio/video synchronization
- Has higher latency due to sequential shot generation

The new approach:
- Makes a single Seedance API call with a concatenated prompt describing all shots
- Maintains better visual consistency across the entire video
- Eliminates assembly complexity
- Reduces total generation time

## Design Decisions

### Approach Selection

**Chosen: Option B - Complete Replacement**

We considered three approaches:
1. **Minimal Change** - Add full-video mode alongside existing shot-by-shot mode
2. **Complete Replacement** - Remove shot-by-shot generation entirely ✅
3. **Hybrid** - Auto-select based on video duration

**Rationale for Option B:**
- Simplest codebase with no redundancy
- Aligns with the end goal of full-video generation
- Easier to maintain long-term
- User confirmed this is the desired final state

**Trade-offs:**
- Higher risk (no fallback to shot-by-shot)
- Requires thorough testing before deployment
- Must work within Seedance duration limits

### Git Workflow

- Development on `develop` branch
- Merge to `main` after testing and validation
- Each major milestone committed separately

## Architecture

### High-Level Flow

```
┌─────────────────┐
│  Upload Video   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Whole-Video     │
│ Analysis        │
│ (Gemini)        │
│ - Plot          │
│ - Characters    │
│ - Scenes        │
│ - All Shots     │
│   (with timing  │
│    & dialogue)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Generate        │
│ Reference       │
│ Assets          │
│ - Character     │
│   3-views       │
│ - Scene images  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Concatenate     │
│ Shot Prompts    │
│ into Full       │
│ Video Prompt    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Single Seedance │
│ API Call        │
│ - Full prompt   │
│ - All ref imgs  │
│ - Original vid  │
│ - Total duration│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Download Result │
│ (Complete Video)│
└─────────────────┘
```

### Component Changes

#### Backend Services

**New Functions:**
- `buildFullVideoPrompt()` in `generationService.js`
  - Concatenates all shot descriptions into a single prompt
  - Follows the user-provided template format

**Modified Functions:**
- `generateSegment()` in `generationService.js`
  - Changed from segment generation to full-video generation
  - Collects all character and scene reference images
  - Uses original video as reference
  - Calls Seedance with full video duration

**Deleted Functions:**
- `generateShot()` in `shotGenerationService.js`
- `generateBatchShots()` in `shotGenerationService.js`
- `attemptPendingShotAssembly()` in `shotGenerationService.js`
- All shot-level FFmpeg merging logic

**Preserved Functions:**
- `expandPromptMentions()` - Still needed for @character and #scene expansion
- `collectCharacterReferenceImages()` - Collects all character 3-views
- `collectSceneReferenceImages()` - Collects all scene images
- Analysis and resource generation services (unchanged)

#### API Routes

**Deleted Routes:**
- `POST /api/generation/shots/generate` - Single shot generation
- `POST /api/generation/shots/generate-batch` - Batch shot generation

**Modified Routes:**
- `POST /api/generation/generate` - Changed to full-video generation
  - Input: `video_id`, `style_mode`, `ratio`, `use_reference_video`, `use_reference_frame`
  - Output: Single `GenerationTask` for the full video

**Preserved Routes:**
- `GET /api/generation/:taskId` - Query task status (unchanged)

#### Database

**Preserved Tables:**
- `videos` - Video metadata
- `analyses` - Whole-video analysis results
- `segments` - Segment info (used for preview only, not generation)
- `generation_tasks` - Now stores full-video generation tasks
- `resource_image_assets` - Character/scene reference images
- `background_assets` - Background assets

**Deprecated Tables:**
- `shot_generation_tasks` - No longer used, but kept for backward compatibility

**Model Changes:**

`GenerationTask.meta` field:
```javascript
{
  source: 'full_video_generation',  // Identifies full-video generation
  requestedDurationSeconds: 60.5,   // Total video duration
  // Removed: shotIndex, shotId, etc.
}
```

`Segment.analysis` field:
```javascript
{
  shots: [...],  // Preserved for frontend preview
  // Removed: shotAssembly, pendingAssembly, etc.
}
```

#### Frontend

**Deleted UI Elements:**
- "Generate Current Shot" button on segment cards
- "Batch Generate Shots" button on segment cards
- Individual shot generation progress indicators
- Shot assembly progress indicators

**New/Modified UI Elements:**
- "Generate Full Video" button on main page (shown after analysis completes)
- Full-video generation progress bar
- Direct full-video preview after generation completes

**Component Changes:**

`MainPage.jsx`:
```jsx
// New: Full-video generation button
{analysis && (
  <button onClick={handleGenerateFullVideo}>
    Generate Full Video
  </button>
)}
```

`SegmentCard.jsx`:
```jsx
// Simplified to preview-only card
// Shows: segment info, shot list (for preview)
// Removed: generation buttons, progress bars, assembly status
```

`useGeneration.js`:
```javascript
// Deleted: generateShot(), generateBatchShots()
// New: generateFullVideo()
```

## Prompt Format

### Template Structure

The concatenated prompt follows this format:

```
【风格】{style description}

【角色】@{char_id_1}{char_name_1}、@{char_id_2}{char_name_2}、...

【场景】@{scene_id_1}{scene_name_1}、@{scene_id_2}{scene_name_2}、...

【分镜头】
【{start}-{end}秒】镜头{id}：{shot_description}。对白口型指导：{dialogue or "无对白"}

【{start}-{end}秒】镜头{id}：{shot_description}。对白口型指导：{dialogue or "无对白"}

...
```

### Example

```
【风格】真人写实电影风格，真实演员质感，欧美校园悬疑现实题材，真实大学礼堂实景，真实暴雨天气，真实皮肤质感，真实服装材质，真实镜头语言，空间清晰，亮度自然，带戏剧张力但不过度昏暗，不阴森，不恐怖，竖屏9:16，高清，细节丰富，不要字幕，不要背景音乐。

【角色】@2595f9ad-bb4b-462e-b199-c0fd361d88c5露西、@2fa4151a-ab81-4f9d-8240-67f932be5ba5杰森、@8d5e1ec8-b668-4e2a-a4b3-2e85a3fccaee诺亚、@26723b33-5489-4e3d-874e-a4b2bfc1f730玛雅、毕业生群演

【场景】礼堂外区域、@a61f7969-a1a3-4510-8434-1258595ee216礼堂入口区域

【分镜头】
【0-4秒】镜头1：大全景，缓慢推进。画面：大学礼堂外暴雨很大，穿毕业袍的学生抱着花束和学士帽匆忙跑向礼堂，地面湿滑反光，礼堂门口灯光明亮，毕业典礼还在继续。动作：群演跑动、躲雨、护着花束往礼堂里走。音效：暴雨声、踩水声、远处人群杂乱声。对白口型指导：无对白

【4-7秒】镜头2：中景，固定镜头。画面：露西穿着被雨淋湿的白色连衣裙，头发湿透，手里紧紧握着手机，站在礼堂门外，死死盯着门口旁边的大屏幕。动作：露西站定不动，呼吸急促，抬眼看向屏幕。音效：暴雨声、呼吸声、礼堂里隐约传来的掌声。对白口型指导：无对白

【7-9秒】镜头3：特写，固定镜头。画面：礼堂门口附近的大屏幕上清楚显示"Outstanding Graduate - Jason"，屏幕表面有雨水滑落。动作：镜头停留在名字上。音效：雨水拍打声、礼堂里隐约掌声。对白口型指导：无对白
```

### Implementation

```javascript
const buildFullVideoPrompt = ({
  analysis,
  video,
  styleMode,
  styleTemplates,
  useReferenceVideo = true,
  useReferenceFrame = true
}) => {
  // 1. Style section
  const stylePrompt = resolveStyleTemplate({
    styleMode,
    styleTemplates,
    templateKey: 'videoGenerationStylePrompt'
  });
  
  // 2. Character section
  const characters = analysis.characters || [];
  const characterList = characters
    .map(char => `@${char.id}${char.name}`)
    .join('、');
  
  // 3. Scene section
  const backgrounds = analysis.backgrounds || [];
  const sceneList = backgrounds
    .map(bg => `@${bg.id}${bg.name}`)
    .join('、');
  
  // 4. Shot sequence section
  const timeAnchors = analysis.timeAnchors || [];
  const shotDescriptions = [];
  
  timeAnchors.forEach(anchor => {
    const shots = anchor.shots || [];
    shots.forEach(shot => {
      const startTime = shot.startTime.toFixed(1);
      const endTime = shot.endTime.toFixed(1);
      
      let shotDesc = `【${startTime}-${endTime}秒】`;
      shotDesc += `镜头${shot.id}：`;
      shotDesc += shot.prompt;
      
      // Add dialogue
      if (shot.speech?.hasDialogue && shot.speech?.transcript) {
        shotDesc += `。对白口型指导："${shot.speech.transcript}"`;
        if (shot.speech.speechStyle) {
          shotDesc += `，说话方式：${shot.speech.speechStyle}`;
        }
      } else {
        shotDesc += `。对白口型指导：无对白`;
      }
      
      shotDescriptions.push(shotDesc);
    });
  });
  
  // 5. Concatenate final prompt
  return [
    `【风格】${stylePrompt}`,
    `【角色】${characterList}`,
    `【场景】${sceneList}`,
    `【分镜头】`,
    ...shotDescriptions
  ].join('\n\n');
};
```

## Analysis Prompt Adjustments

### Current State

The whole-video analysis prompt in `promptBlueprints.js` already includes:
- ✅ `startTime` and `endTime` for each shot
- ✅ `prompt` field for each shot (shot description)
- ✅ `speech` field when `extractSubtitles` or `parseAudio` is enabled

### Required Adjustments

Enhance the shot prompt requirements to ensure sufficient detail for Seedance:

```javascript
// In buildVideoAnalysisPromptSections()

'18. 每个 shot 的 prompt 必须是完整的镜头描述，包含：',
'    - 景别（大全景/全景/中景/近景/特写）',
'    - 镜头运动（固定/推进/拉远/横移/跟随）',
'    - 画面内容（场景、角色位置、动作）',
'    - 必须包含 @角色名 和 #场景名 标记',
'    - 动作描述要具体（不要只写"站着"，要写"站在画面左侧，面向右侧"）',
'    - 视线和朝向要明确',
'19. shot.prompt 示例：',
'    "中景，固定镜头。@露西 穿白色连衣裙站在 #礼堂入口 画面中央，浑身湿透，',
'     手里紧握手机，抬眼直视前方，呼吸急促。背景是礼堂大门和暴雨。"',
```

The `speech` field structure is already correct:
```javascript
speech: {
  transcript: "How the hell did you get in here?",
  subtitleLines: [...],
  speechStyle: "语速快，语气质问，带愤怒",
  hasDialogue: true
}
```

## Data Flow

### Full Video Generation Flow

```javascript
// 1. User triggers generation
POST /api/generation/generate
{
  video_id: 123,
  style_mode: 'realistic',
  ratio: '16:9',
  use_reference_video: true,
  use_reference_frame: true
}

// 2. Backend: generationService.generateSegment()
const video = await Video.findByPk(videoId);
const analysis = await Analysis.findOne({ where: { videoId } });

// 3. Build full video prompt
const fullPrompt = buildFullVideoPrompt({
  analysis: analysis.result,
  video,
  styleMode,
  styleTemplates: analysis.analysisOptions?.styleTemplates,
  useReferenceVideo,
  useReferenceFrame
});

// 4. Collect all reference assets
const allCharacterIds = analysis.result.characters.map(c => c.id);
const allSceneIds = analysis.result.backgrounds.map(b => b.id);
const characterImages = await collectCharacterReferenceImages(allCharacterIds);
const sceneImages = await collectSceneReferenceImages(allSceneIds);
const referenceImages = [...characterImages, ...sceneImages];

// 5. Prepare reference video (entire original video)
const referenceVideo = useReferenceVideo ? video.filePath : null;

// 6. Create generation task
const task = await GenerationTask.create({
  videoId,
  segmentId: null,
  status: TASK_STATUS.pending,
  prompt: fullPrompt,
  meta: {
    engine: 'seedance',
    ratio,
    styleMode,
    useReferenceVideo,
    useReferenceFrame,
    source: 'full_video_generation',
    requestedDurationSeconds: video.duration
  }
});

// 7. Call Seedance
const result = await generateWithSeedDance({
  prompt: fullPrompt,
  referenceImages,
  referenceVideo,
  durationSeconds: video.duration,
  ratio,
  taskId: task.id
});

// 8. Update task status
await task.update({
  status: TASK_STATUS.completed,
  resultUrl: result.resultUrl,
  progress: 100
});

// 9. Return task
return task;
```

### Frontend Flow

```javascript
// 1. User clicks "Generate Full Video"
const handleGenerateFullVideo = async () => {
  setIsGenerating(true);
  
  try {
    // 2. Call API
    const response = await api.post('/api/generation/generate', {
      video_id: currentVideo.id,
      style_mode: analysisOptions.styleMode,
      ratio: globalRatio,
      use_reference_video: true,
      use_reference_frame: true
    });
    
    const taskId = response.data.task.task_id;
    
    // 3. Poll task status
    const result = await pollTaskStatus(taskId);
    
    // 4. Show result
    setGeneratedVideoUrl(result.result_url);
    setIsGenerating(false);
  } catch (error) {
    console.error('Generation failed:', error);
    setIsGenerating(false);
  }
};
```

## Error Handling

### Seedance Duration Limits

Current Seedance limits: 4-15 seconds per generation.

**Strategy:**
- If video duration > 15 seconds, the generation will fail
- User must ensure video is within Seedance limits before generation
- Frontend should validate duration before allowing generation
- Backend should return clear error message if duration exceeds limit

**Future Enhancement:**
- If Seedance supports longer durations in the future, update `MAX_SEED_DANCE_GENERATION_DURATION_SECONDS` constant
- Or implement automatic segmentation for longer videos

### Reference Asset Failures

If character 3-views or scene images fail to generate:
- Proceed with generation using only available assets
- Log warning but don't block generation
- Seedance will rely more on text descriptions

### Prompt Length Limits

If concatenated prompt exceeds Seedance limits:
- Log error and fail generation
- User must simplify shot descriptions or reduce video length

## Testing Strategy

### Unit Tests

- `buildFullVideoPrompt()` function
  - Test with various analysis structures
  - Test with/without dialogue
  - Test character and scene ID formatting
  - Test time formatting

### Integration Tests

- Full generation flow end-to-end
- Reference asset collection
- Seedance API integration
- Task status updates

### Manual Testing

1. Upload a short video (5-10 seconds)
2. Complete whole-video analysis
3. Generate character 3-views and scene images
4. Trigger full-video generation
5. Verify generated video matches prompt
6. Check dialogue synchronization
7. Verify visual consistency across shots

### Regression Testing

- Ensure analysis still works correctly
- Ensure reference asset generation still works
- Ensure video upload and metadata extraction still works

## Migration Plan

### Phase 1: Development (develop branch)

1. Implement `buildFullVideoPrompt()` function
2. Modify `generateSegment()` for full-video generation
3. Delete shot-level generation functions
4. Update API routes
5. Update frontend components
6. Add unit tests

### Phase 2: Testing (develop branch)

1. Run unit tests
2. Run integration tests
3. Manual testing with sample videos
4. Performance testing
5. Fix bugs and iterate

### Phase 3: Deployment (merge to main)

1. Final review of all changes
2. Update documentation
3. Merge `develop` to `main`
4. Deploy to production
5. Monitor for issues

## Rollback Plan

If critical issues are discovered after deployment:

1. Revert the merge commit on `main`
2. Redeploy previous version
3. Fix issues on `develop` branch
4. Re-test thoroughly
5. Attempt deployment again

## Performance Considerations

### Expected Improvements

- **Reduced API calls:** 1 call instead of N calls (where N = number of shots)
- **Reduced latency:** No sequential shot generation waiting
- **Reduced complexity:** No FFmpeg assembly overhead

### Potential Concerns

- **Longer single generation time:** One long video takes longer than one short shot
- **Higher memory usage:** Larger prompt and more reference assets in single call
- **All-or-nothing:** If generation fails, entire video fails (no partial results)

### Monitoring

- Track generation success rate
- Monitor generation duration
- Monitor Seedance API response times
- Track user satisfaction with results

## Documentation Updates

### Files to Update

- `README.md` - Update pipeline description
- `docs/pipeline.md` - Update detailed flow
- `docs/Summary0.md` - Update current implementation status
- `CLAUDE.md` - Update project overview

### API Documentation

- Update Swagger/OpenAPI specs
- Remove deprecated endpoints
- Update request/response examples

## Success Criteria

This design is considered successful if:

1. ✅ Full-video generation produces coherent videos with consistent style
2. ✅ Dialogue synchronization works correctly across all shots
3. ✅ Visual consistency is maintained throughout the video
4. ✅ Generation time is acceptable (comparable to or better than shot-by-shot)
5. ✅ Success rate is high (>90% for videos within duration limits)
6. ✅ Code is simpler and easier to maintain than previous approach
7. ✅ No critical bugs in production

## Open Questions

1. **Seedance duration limits:** What is the actual maximum duration Seedance can handle?
   - Current assumption: 4-15 seconds
   - Need to verify with actual API testing

2. **Prompt length limits:** Is there a maximum prompt length for Seedance?
   - Need to test with very long prompts (many shots)

3. **Reference asset limits:** How many reference images can Seedance accept?
   - Current code has `REFERENCE_IMAGE_LIMIT = 9`
   - Need to verify this is sufficient for full-video generation

## Appendix

### Related Files

**Backend:**
- `backend/services/generationService.js` - Main generation logic
- `backend/services/shotGenerationService.js` - To be simplified/deleted
- `backend/services/seedDanceService.js` - Seedance API integration
- `backend/routes/generation.js` - API routes
- `shared/promptBlueprints.js` - Analysis prompt templates
- `shared/styleTemplates.js` - Style templates

**Frontend:**
- `frontend/src/pages/MainPage.jsx` - Main UI
- `frontend/src/components/SegmentCard.jsx` - Segment preview
- `frontend/src/hooks/useGeneration.js` - Generation logic
- `frontend/src/services/api.js` - API client

**Database:**
- `backend/models/GenerationTask.js` - Generation task model
- `backend/models/Segment.js` - Segment model

### References

- Original project documentation: `docs/Overall_Arch.md`, `docs/pipeline.md`
- Seedance API documentation: (external)
- Gemini API documentation: (external)
