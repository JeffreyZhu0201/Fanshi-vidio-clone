# Full Video Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor video generation from shot-by-shot assembly to single full-video generation with concatenated prompts.

**Architecture:** Replace individual shot generation + FFmpeg assembly with a single Seedance API call using concatenated shot descriptions. Build `buildFullVideoPrompt()` to format all shots into one prompt, modify `generateSegment()` to handle full-video generation, and remove shot-level generation logic.

**Tech Stack:** Node.js, Express, Sequelize, React, Vite, Seedance API, FFmpeg (for preprocessing only)

---

## File Structure

### Backend Files

**New Files:**
- None (all changes are modifications)

**Modified Files:**
- `backend/services/generationService.js` - Add `buildFullVideoPrompt()`, modify `generateSegment()`
- `backend/services/shotGenerationService.js` - Remove shot generation functions
- `backend/routes/generation.js` - Remove shot generation routes
- `backend/controllers/generationController.js` - Remove shot generation controllers
- `shared/promptBlueprints.js` - Enhance shot prompt requirements

**Deleted Functions:**
- `generateShot()` in `shotGenerationService.js`
- `generateBatchShots()` in `shotGenerationService.js`
- `attemptPendingShotAssembly()` in `shotGenerationService.js`

### Frontend Files

**Modified Files:**
- `frontend/src/hooks/useGeneration.js` - Remove shot generation hooks, add full-video generation
- `frontend/src/pages/MainPage.jsx` - Add full-video generation button
- `frontend/src/components/SegmentCard.jsx` - Simplify to preview-only

---

## Task 1: Add buildFullVideoPrompt Function

**Files:**
- Modify: `backend/services/generationService.js:1-100`
- Test: Manual testing (unit tests in later task)

- [ ] **Step 1: Add buildFullVideoPrompt function**

Add this function after the existing imports and before `generateSegment()`:

```javascript
/**
 * Build full video prompt by concatenating all shot descriptions
 * @param {Object} params
 * @param {Object} params.analysis - Analysis result with characters, backgrounds, timeAnchors
 * @param {Object} params.video - Video metadata
 * @param {string} params.styleMode - Style mode (realistic/comic_drama)
 * @param {Object} params.styleTemplates - User style templates
 * @param {boolean} params.useReferenceVideo - Whether to use reference video
 * @param {boolean} params.useReferenceFrame - Whether to use reference frame
 * @returns {string} Concatenated prompt for full video
 */
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
      const startTime = Number(shot.startTime ?? 0).toFixed(1);
      const endTime = Number(shot.endTime ?? 0).toFixed(1);
      
      let shotDesc = `【${startTime}-${endTime}秒】`;
      shotDesc += `镜头${shot.id}：`;
      shotDesc += String(shot.prompt ?? '').trim();
      
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
  const sections = [
    `【风格】${stylePrompt}`,
    `【角色】${characterList}`,
    `【场景】${sceneList}`,
    `【分镜头】`,
    ...shotDescriptions
  ];
  
  return sections.join('\n\n');
};
```

- [ ] **Step 2: Export buildFullVideoPrompt**

Find the export statement at the bottom of `generationService.js` and add `buildFullVideoPrompt`:

```javascript
export {
  // ... existing exports
  buildFullVideoPrompt,
  // ... rest of exports
};
```

- [ ] **Step 3: Verify syntax**

Run: `node --check backend/services/generationService.js`
Expected: No syntax errors

- [ ] **Step 4: Commit**

```bash
git add backend/services/generationService.js
git commit -m "feat: add buildFullVideoPrompt for concatenating shot descriptions"
```

---

## Task 2: Modify generateSegment for Full-Video Generation

**Files:**
- Modify: `backend/services/generationService.js` (the `startGeneration` function)
- Test: Manual testing

- [ ] **Step 1: Locate startGeneration function**

Find the `startGeneration` function in `generationService.js` (around line 1300-1500).

- [ ] **Step 2: Replace startGeneration implementation**

Replace the entire `startGeneration` function with this new implementation:

```javascript
const startGeneration = async ({
  segmentId = null,
  prompt = '',
  ratio = env.SEED_DANCE_RATIO,
  styleMode = null,
  useReferenceVideo = true,
  useReferenceFrame = true
}) => {
  // Get video and analysis
  let videoId = null;
  let segment = null;
  
  if (segmentId) {
    segment = await Segment.findByPk(segmentId);
    if (!segment) {
      throw new AppError('Segment not found', 404);
    }
    videoId = segment.videoId;
  }
  
  if (!videoId) {
    throw new AppError('Video ID is required', 400);
  }
  
  const video = await Video.findByPk(videoId);
  if (!video) {
    throw new AppError('Video not found', 404);
  }
  
  const analysis = await Analysis.findOne({ where: { videoId } });
  if (!analysis) {
    throw new AppError('Analysis not found. Please analyze the video first.', 404);
  }
  
  // Determine style mode
  const analysisOptions = normalizeAnalysisOptions(analysis.analysisOptions);
  const effectiveStyleMode = normalizeStyleMode(styleMode ?? analysisOptions.styleMode);
  
  // Build full video prompt
  const fullPrompt = buildFullVideoPrompt({
    analysis: analysis.result,
    video,
    styleMode: effectiveStyleMode,
    styleTemplates: analysisOptions.styleTemplates,
    useReferenceVideo,
    useReferenceFrame
  });
  
  logger.info('Built full video prompt', {
    videoId,
    promptLength: fullPrompt.length,
    shotCount: (analysis.result.timeAnchors || []).reduce(
      (sum, anchor) => sum + (anchor.shots || []).length,
      0
    )
  });
  
  // Collect all character reference images
  const allCharacterIds = (analysis.result.characters || []).map(c => c.id);
  const characterImages = await collectCharacterReferenceImages(allCharacterIds, videoId);
  
  // Collect all scene reference images
  const allSceneIds = (analysis.result.backgrounds || []).map(b => b.id);
  const sceneImages = await collectSceneReferenceImages(allSceneIds, videoId);
  
  // Combine all reference images
  const referenceImages = composeSeedDanceReferenceImages([...characterImages, ...sceneImages]);
  
  logger.info('Collected reference images for full video', {
    videoId,
    characterImageCount: characterImages.length,
    sceneImageCount: sceneImages.length,
    totalReferenceImages: referenceImages.length
  });
  
  // Prepare reference video (entire original video)
  const normalizedUseReferenceVideo = normalizeUseReferenceVideo(useReferenceVideo);
  const referenceVideoPath = normalizedUseReferenceVideo ? video.filePath : null;
  
  // Use full video duration
  const durationSeconds = Number(video.duration ?? 0);
  
  if (durationSeconds <= 0) {
    throw new AppError('Invalid video duration', 400);
  }
  
  // Create generation task
  const task = await GenerationTask.create({
    videoId,
    segmentId: null, // Full video generation, not tied to specific segment
    status: TASK_STATUS.pending,
    progress: 0,
    prompt: fullPrompt,
    optimizedPrompt: fullPrompt, // No optimization for full video
    resultUrl: null,
    errorMessage: null,
    meta: {
      engine: 'seedance',
      ratio: normalizeGenerationRatio(ratio),
      styleMode: effectiveStyleMode,
      useReferenceVideo: normalizedUseReferenceVideo,
      useReferenceFrame: normalizeUseReferenceFrame(useReferenceFrame),
      source: 'full_video_generation',
      requestedDurationSeconds: durationSeconds,
      shotCount: (analysis.result.timeAnchors || []).reduce(
        (sum, anchor) => sum + (anchor.shots || []).length,
        0
      )
    }
  });
  
  logger.info('Created full video generation task', {
    taskId: task.id,
    videoId,
    durationSeconds
  });
  
  // Broadcast task creation
  broadcastGenerationTaskUpdate(task);
  
  // Start generation asynchronously
  (async () => {
    try {
      await task.update({ status: TASK_STATUS.processing, progress: 10 });
      broadcastGenerationTaskUpdate(task);
      
      // Call Seedance
      const result = await generateWithSeedDance({
        prompt: fullPrompt,
        referenceImages,
        referenceVideo: referenceVideoPath,
        durationSeconds,
        ratio: normalizeGenerationRatio(ratio),
        taskId: task.id,
        videoId,
        segmentId: null
      });
      
      // Update task with result
      await task.update({
        status: TASK_STATUS.completed,
        progress: 100,
        resultUrl: result.resultUrl,
        meta: {
          ...task.meta,
          remoteTaskId: result.remoteTaskId,
          remoteStatus: result.remoteStatus,
          actualDurationSeconds: result.actualDurationSeconds
        }
      });
      
      logger.info('Full video generation completed', {
        taskId: task.id,
        videoId,
        resultUrl: result.resultUrl
      });
      
      broadcastGenerationTaskUpdate(task);
    } catch (error) {
      logger.error('Full video generation failed', {
        taskId: task.id,
        videoId,
        error: error.message
      });
      
      await task.update({
        status: TASK_STATUS.failed,
        progress: 0,
        errorMessage: error.message || 'Generation failed'
      });
      
      broadcastGenerationTaskUpdate(task);
    }
  })();
  
  return {
    success: true,
    task: serializeGenerationTask(task)
  };
};
```

- [ ] **Step 3: Verify syntax**

Run: `node --check backend/services/generationService.js`
Expected: No syntax errors

- [ ] **Step 4: Commit**

```bash
git add backend/services/generationService.js
git commit -m "refactor: modify generateSegment for full-video generation"
```

---

## Task 3: Remove Shot Generation Routes

**Files:**
- Modify: `backend/routes/generation.js`

- [ ] **Step 1: Remove shot generation route imports**

In `backend/routes/generation.js`, remove these imports:

```javascript
// Remove these lines:
import { generateShot, generateShotBatch } from '../controllers/generationController.js';
```

- [ ] **Step 2: Remove shot generation routes**

Remove these route definitions:

```javascript
// Remove these lines:
router.post('/shots/generate', validateRequest({ body: generateShotBodySchema }), asyncHandler(generateShot));
router.post(
  '/shots/generate-batch',
  validateRequest({ body: generateShotBatchBodySchema }),
  asyncHandler(generateShotBatch)
);
router.get(
  '/shots/:taskId',
  validateRequest({ params: shotGenerationTaskIdParamSchema }),
  asyncHandler(fetchShotGenerationTask)
);
```

- [ ] **Step 3: Remove validation schema imports**

Remove these from the imports:

```javascript
// Remove from validationSchemas import:
generateShotBodySchema,
generateShotBatchBodySchema,
shotGenerationTaskIdParamSchema
```

- [ ] **Step 4: Verify the file**

The file should now only have:
- `generateSegment` route
- `fetchGenerationTask` route

- [ ] **Step 5: Verify syntax**

Run: `node --check backend/routes/generation.js`
Expected: No syntax errors

- [ ] **Step 6: Commit**

```bash
git add backend/routes/generation.js
git commit -m "refactor: remove shot generation routes"
```

---

## Task 4: Remove Shot Generation Controllers

**Files:**
- Modify: `backend/controllers/generationController.js`

- [ ] **Step 1: Remove shot generation controller imports**

Remove these imports:

```javascript
// Remove these lines:
import {
  getShotGenerationTaskStatus,
  startShotBatchGeneration,
  startShotGeneration
} from '../services/shotGenerationService.js';
```

- [ ] **Step 2: Remove shot generation controller functions**

Remove these functions:

```javascript
// Remove these functions:
const generateShot = async (request, response) => { ... };
const generateShotBatch = async (request, response) => { ... };
const fetchShotGenerationTask = async (request, response) => { ... };
```

- [ ] **Step 3: Update exports**

Change the export to only include:

```javascript
export { generateSegment, fetchGenerationTask };
```

- [ ] **Step 4: Verify syntax**

Run: `node --check backend/controllers/generationController.js`
Expected: No syntax errors

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/generationController.js
git commit -m "refactor: remove shot generation controllers"
```

---

## Task 5: Comment Out Shot Generation Service Functions

**Files:**
- Modify: `backend/services/shotGenerationService.js`

Note: We're commenting out rather than deleting to preserve the code for reference during testing.

- [ ] **Step 1: Comment out generateShot function**

Find the `generateShot` export function and comment it out with a note:

```javascript
// DEPRECATED: Shot-by-shot generation replaced with full-video generation
// Kept for reference during migration
/*
const generateShot = async ({ ... }) => {
  // ... entire function body
};
*/
```

- [ ] **Step 2: Comment out generateBatchShots function**

```javascript
// DEPRECATED: Batch shot generation replaced with full-video generation
/*
const generateBatchShots = async ({ ... }) => {
  // ... entire function body
};
*/
```

- [ ] **Step 3: Comment out attemptPendingShotAssembly function**

```javascript
// DEPRECATED: Shot assembly no longer needed with full-video generation
/*
const attemptPendingShotAssembly = async ({ ... }) => {
  // ... entire function body
};
*/
```

- [ ] **Step 4: Update exports**

Comment out the deprecated exports:

```javascript
export {
  // DEPRECATED exports - commented out
  // generateShot,
  // generateBatchShots,
  // attemptPendingShotAssembly,
  
  // Keep other exports that may still be used
  // ... other exports
};
```

- [ ] **Step 5: Verify syntax**

Run: `node --check backend/services/shotGenerationService.js`
Expected: No syntax errors

- [ ] **Step 6: Commit**

```bash
git add backend/services/shotGenerationService.js
git commit -m "refactor: comment out deprecated shot generation functions"
```

---

## Task 6: Enhance Analysis Prompt for Shot Details

**Files:**
- Modify: `shared/promptBlueprints.js`

- [ ] **Step 1: Locate shot prompt requirements**

Find the section in `buildVideoAnalysisPromptSections()` that describes shot.prompt requirements (around line 140-160).

- [ ] **Step 2: Add enhanced shot prompt requirements**

After the existing shot requirements, add these new requirements:

```javascript
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

- [ ] **Step 3: Verify syntax**

Run: `node --check shared/promptBlueprints.js`
Expected: No syntax errors

- [ ] **Step 4: Commit**

```bash
git add shared/promptBlueprints.js
git commit -m "feat: enhance shot prompt requirements for full-video generation"
```

---

## Task 7: Update Frontend useGeneration Hook - Remove Shot Generation

**Files:**
- Modify: `frontend/src/hooks/useGeneration.js`

- [ ] **Step 1: Remove shot generation API imports**

Remove these imports:

```javascript
// Remove these:
import { generateShot, generateShotBatch, getShotGenerationTask } from '../services/api.js';
```

- [ ] **Step 2: Comment out shot generation functions**

Find and comment out these functions:

```javascript
// DEPRECATED: Shot generation replaced with full-video generation
/*
const handleGenerateShot = async ({ ... }) => {
  // ... function body
};

const handleGenerateBatchShots = async ({ ... }) => {
  // ... function body
};
*/
```

- [ ] **Step 3: Remove shot generation from return object**

In the return statement, comment out:

```javascript
return {
  // ... other exports
  // DEPRECATED:
  // generateShot: handleGenerateShot,
  // generateBatchShots: handleGenerateBatchShots,
  // ... rest
};
```

- [ ] **Step 4: Verify syntax**

Run: `npm run check` in frontend directory
Expected: No syntax errors (may have unused import warnings, that's OK)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useGeneration.js
git commit -m "refactor: remove shot generation from useGeneration hook"
```

---

## Task 8: Add Full-Video Generation to Frontend Hook

**Files:**
- Modify: `frontend/src/hooks/useGeneration.js`

- [ ] **Step 1: Add generateFullVideo function**

Add this new function in `useGeneration.js`:

```javascript
const handleGenerateFullVideo = async ({
  videoId,
  styleMode,
  ratio = '16:9',
  useReferenceVideo = true,
  useReferenceFrame = true
}) => {
  try {
    setGenerationStore({ isGenerating: true, generationError: null });
    
    const response = await generateSegment({
      video_id: videoId,
      style_mode: styleMode,
      ratio,
      use_reference_video: useReferenceVideo,
      use_reference_frame: useReferenceFrame
    });
    
    const taskId = response.task.task_id;
    
    // Poll for completion
    let attempts = 0;
    const maxAttempts = 180; // 15 minutes with 5s intervals
    
    while (attempts < maxAttempts) {
      await sleep(5000);
      
      const taskStatus = await getGenerationTask(taskId);
      
      if (taskStatus.status === 'completed') {
        setGenerationStore({
          isGenerating: false,
          generatedVideoUrl: taskStatus.result_url,
          generationProgress: 100
        });
        return taskStatus;
      }
      
      if (taskStatus.status === 'failed') {
        throw new Error(taskStatus.error_message || 'Generation failed');
      }
      
      // Update progress
      setGenerationStore({
        generationProgress: taskStatus.progress || 50
      });
      
      attempts++;
    }
    
    throw new Error('Generation timeout');
  } catch (error) {
    const errorMessage = getGenerationErrorMessage(error, '视频生成');
    setGenerationStore({
      isGenerating: false,
      generationError: errorMessage,
      generationProgress: 0
    });
    throw error;
  }
};
```

- [ ] **Step 2: Add to return object**

Add to the return statement:

```javascript
return {
  // ... existing exports
  generateFullVideo: handleGenerateFullVideo,
  // ... rest
};
```

- [ ] **Step 3: Verify syntax**

Run: `npm run check` in frontend directory
Expected: No syntax errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useGeneration.js
git commit -m "feat: add generateFullVideo to useGeneration hook"
```

---

## Task 9: Add Full-Video Generation Button to MainPage

**Files:**
- Modify: `frontend/src/pages/MainPage.jsx`

- [ ] **Step 1: Import generateFullVideo from hook**

Ensure `useGeneration` is imported and destructure `generateFullVideo`:

```javascript
const {
  // ... existing destructured values
  generateFullVideo,
  isGenerating,
  generationProgress,
  generationError,
  generatedVideoUrl
} = useGeneration();
```

- [ ] **Step 2: Add full-video generation handler**

Add this handler function in the component:

```javascript
const handleGenerateFullVideo = async () => {
  if (!currentVideo?.id || !analysis) {
    return;
  }
  
  try {
    await generateFullVideo({
      videoId: currentVideo.id,
      styleMode: analysisOptions.styleMode,
      ratio: globalRatio,
      useReferenceVideo: true,
      useReferenceFrame: true
    });
  } catch (error) {
    console.error('Full video generation failed:', error);
  }
};
```

- [ ] **Step 3: Add generation button UI**

Find the section after analysis display and add:

```jsx
{analysis && !isGenerating && (
  <div className="mt-6 p-4 border border-white/10 rounded-lg bg-black/20">
    <h3 className="text-lg font-medium mb-3">生成完整视频</h3>
    <p className="text-sm text-white/60 mb-4">
      使用整片分析结果，一次性生成完整视频（所有镜头拼接为一个提示词）
    </p>
    <button
      onClick={handleGenerateFullVideo}
      className="btn-primary"
      disabled={!currentVideo?.id}
    >
      生成完整视频
    </button>
  </div>
)}

{isGenerating && (
  <div className="mt-6 p-4 border border-brand-500/20 rounded-lg bg-brand-500/5">
    <h3 className="text-lg font-medium mb-3">正在生成视频...</h3>
    <ProgressBar progress={generationProgress} />
    <p className="text-sm text-white/60 mt-2">
      进度: {generationProgress}%
    </p>
  </div>
)}

{generatedVideoUrl && !isGenerating && (
  <div className="mt-6 p-4 border border-emerald-500/20 rounded-lg bg-emerald-500/5">
    <h3 className="text-lg font-medium mb-3">生成完成</h3>
    <video
      src={generatedVideoUrl}
      controls
      className="w-full max-w-2xl rounded-lg"
    />
    <a
      href={generatedVideoUrl}
      download
      className="btn-secondary mt-4 inline-block"
    >
      下载视频
    </a>
  </div>
)}

{generationError && (
  <div className="mt-6 p-4 border border-accent-500/20 rounded-lg bg-accent-500/5">
    <h3 className="text-lg font-medium mb-2">生成失败</h3>
    <p className="text-sm text-white/80">{generationError}</p>
  </div>
)}
```

- [ ] **Step 4: Test in browser**

Run: `npm run dev` in frontend directory
Open: `http://localhost:5173`
Expected: See "生成完整视频" button after analysis completes

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/MainPage.jsx
git commit -m "feat: add full-video generation UI to MainPage"
```

---

## Task 10: Simplify SegmentCard to Preview-Only

**Files:**
- Modify: `frontend/src/components/SegmentCard.jsx`

- [ ] **Step 1: Remove shot generation buttons**

Find and remove these UI elements:

```jsx
// Remove these:
<button onClick={handleGenerateShot}>生成当前镜头</button>
<button onClick={handleGenerateBatchShots}>批量生成镜头</button>
```

- [ ] **Step 2: Remove shot generation progress indicators**

Remove:

```jsx
// Remove shot progress bars and status indicators
{shotTasks.map(task => (
  <div key={task.id}>
    <ProgressBar progress={task.progress} />
    <span>{task.status}</span>
  </div>
))}
```

- [ ] **Step 3: Remove shot assembly status**

Remove:

```jsx
// Remove assembly status display
{segment.analysis?.shotAssembly && (
  <div>Assembly status: {segment.analysis.shotAssembly.status}</div>
)}
```

- [ ] **Step 4: Keep shot list for preview**

Keep the shot list display (for preview purposes):

```jsx
{/* Keep this - shows shot info for preview */}
<div className="shots-preview">
  <h4>包含 {segment.analysis?.shots?.length || 0} 个镜头</h4>
  {segment.analysis?.shots?.map(shot => (
    <div key={shot.id} className="shot-preview-item">
      <span className="shot-time">
        {shot.startTime}s - {shot.endTime}s
      </span>
      <span className="shot-summary">{shot.summary}</span>
    </div>
  ))}
</div>
```

- [ ] **Step 5: Add note about preview-only**

Add a note at the top of the component:

```jsx
{/* Note: This component is now preview-only. 
    Shot generation has been replaced with full-video generation. */}
```

- [ ] **Step 6: Test in browser**

Run: `npm run dev` in frontend directory
Expected: Segment cards show shot info but no generation buttons

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/SegmentCard.jsx
git commit -m "refactor: simplify SegmentCard to preview-only (remove shot generation UI)"
```

---

## Task 11: Add Unit Tests for buildFullVideoPrompt

**Files:**
- Create: `backend/__tests__/buildFullVideoPrompt.test.js`

- [ ] **Step 1: Create test file**

Create `backend/__tests__/buildFullVideoPrompt.test.js`:

```javascript
import { buildFullVideoPrompt } from '../services/generationService.js';

describe('buildFullVideoPrompt', () => {
  const mockAnalysis = {
    characters: [
      { id: 'char1', name: '露西' },
      { id: 'char2', name: '杰森' }
    ],
    backgrounds: [
      { id: 'bg1', name: '礼堂入口' },
      { id: 'bg2', name: '礼堂外' }
    ],
    timeAnchors: [
      {
        shots: [
          {
            id: 'shot1',
            startTime: 0,
            endTime: 4,
            prompt: '大全景，缓慢推进。@露西 站在 #礼堂入口',
            speech: null
          },
          {
            id: 'shot2',
            startTime: 4,
            endTime: 7,
            prompt: '中景，固定镜头。@杰森 在 #礼堂外',
            speech: {
              hasDialogue: true,
              transcript: 'Hello',
              speechStyle: '平静'
            }
          }
        ]
      }
    ]
  };

  const mockVideo = {
    id: 1,
    filename: 'test.mp4',
    duration: 10
  };

  test('should build prompt with all sections', () => {
    const result = buildFullVideoPrompt({
      analysis: mockAnalysis,
      video: mockVideo,
      styleMode: 'realistic',
      styleTemplates: null,
      useReferenceVideo: true,
      useReferenceFrame: true
    });

    expect(result).toContain('【风格】');
    expect(result).toContain('【角色】');
    expect(result).toContain('【场景】');
    expect(result).toContain('【分镜头】');
  });

  test('should format character list correctly', () => {
    const result = buildFullVideoPrompt({
      analysis: mockAnalysis,
      video: mockVideo,
      styleMode: 'realistic',
      styleTemplates: null
    });

    expect(result).toContain('@char1露西');
    expect(result).toContain('@char2杰森');
    expect(result).toContain('、');
  });

  test('should format scene list correctly', () => {
    const result = buildFullVideoPrompt({
      analysis: mockAnalysis,
      video: mockVideo,
      styleMode: 'realistic',
      styleTemplates: null
    });

    expect(result).toContain('@bg1礼堂入口');
    expect(result).toContain('@bg2礼堂外');
  });

  test('should format shot with time range', () => {
    const result = buildFullVideoPrompt({
      analysis: mockAnalysis,
      video: mockVideo,
      styleMode: 'realistic',
      styleTemplates: null
    });

    expect(result).toContain('【0.0-4.0秒】');
    expect(result).toContain('【4.0-7.0秒】');
  });

  test('should include dialogue when present', () => {
    const result = buildFullVideoPrompt({
      analysis: mockAnalysis,
      video: mockVideo,
      styleMode: 'realistic',
      styleTemplates: null
    });

    expect(result).toContain('对白口型指导："Hello"');
    expect(result).toContain('说话方式：平静');
  });

  test('should show no dialogue when speech is null', () => {
    const result = buildFullVideoPrompt({
      analysis: mockAnalysis,
      video: mockVideo,
      styleMode: 'realistic',
      styleTemplates: null
    });

    expect(result).toContain('对白口型指导：无对白');
  });

  test('should handle empty characters array', () => {
    const emptyAnalysis = {
      ...mockAnalysis,
      characters: []
    };

    const result = buildFullVideoPrompt({
      analysis: emptyAnalysis,
      video: mockVideo,
      styleMode: 'realistic',
      styleTemplates: null
    });

    expect(result).toContain('【角色】');
  });

  test('should handle empty shots array', () => {
    const emptyAnalysis = {
      ...mockAnalysis,
      timeAnchors: [{ shots: [] }]
    };

    const result = buildFullVideoPrompt({
      analysis: emptyAnalysis,
      video: mockVideo,
      styleMode: 'realistic',
      styleTemplates: null
    });

    expect(result).toContain('【分镜头】');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd backend && npm test -- buildFullVideoPrompt.test.js`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add backend/__tests__/buildFullVideoPrompt.test.js
git commit -m "test: add unit tests for buildFullVideoPrompt"
```

---

## Task 12: Update Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/pipeline.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update README.md pipeline description**

Find the pipeline section and update:

```markdown
### Main Pipeline Flow

1. **Upload** → Original video uploaded
2. **Whole-video Analysis** → Gemini analyzes entire video (plot, characters, scenes, shots with timing and dialogue)
3. **Generate Resources** → Create character three-view images and scene reference images
4. **Concatenate Prompts** → All shot descriptions combined into single prompt
5. **Generate Full Video** → Single Seedance API call with concatenated prompt
6. **Download Result** → Complete video (no assembly needed)
```

- [ ] **Step 2: Update docs/pipeline.md**

Update the detailed flow section:

```markdown
## Current Pipeline (Full-Video Generation)

### 3.8 Full Video Generation

- 接口：`POST /api/generation/generate`
- 服务：`generationService.startGeneration`

当前规则：
- 收集所有角色三视图和场景参考图
- 使用 `buildFullVideoPrompt()` 拼接所有镜头描述
- 一次性调用 Seedance 生成完整视频
- 时长 = 原视频总时长
- 不再需要镜头拼接

提示词格式：
【风格】...
【角色】@角色ID角色名、...
【场景】@场景ID场景名、...
【分镜头】
【开始-结束秒】镜头ID：描述。对白口型指导：...
```

- [ ] **Step 3: Update CLAUDE.md**

Update the key implementation details:

```markdown
### Key Implementation Details

#### Full-Video Generation
- Single Seedance API call for entire video
- All shot descriptions concatenated into one prompt
- Format: 【风格】【角色】【场景】【分镜头】sections
- No shot-level generation or FFmpeg assembly
- Maintains visual consistency across entire video
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/pipeline.md CLAUDE.md
git commit -m "docs: update pipeline documentation for full-video generation"
```

---

## Task 13: Integration Testing

**Files:**
- Test: Manual end-to-end testing

- [ ] **Step 1: Start backend**

Run: `cd backend && npm run dev`
Expected: Server starts on port 5000/5443

- [ ] **Step 2: Start frontend**

Run: `cd frontend && npm run dev`
Expected: Frontend starts on port 5173

- [ ] **Step 3: Upload test video**

1. Open `http://localhost:5173`
2. Upload a short video (5-10 seconds)
3. Verify upload completes

- [ ] **Step 4: Run analysis**

1. Click "开始分析"
2. Wait for analysis to complete
3. Verify analysis results show characters, scenes, and shots

- [ ] **Step 5: Generate reference images**

1. Generate character 3-views
2. Generate scene reference images
3. Verify images are generated

- [ ] **Step 6: Generate full video**

1. Click "生成完整视频" button
2. Verify progress bar appears
3. Wait for generation to complete (may take several minutes)
4. Verify generated video appears

- [ ] **Step 7: Verify generated video**

1. Play the generated video
2. Check that it matches the expected duration
3. Verify visual consistency across shots
4. Check dialogue synchronization if applicable

- [ ] **Step 8: Check backend logs**

Run: `tail -f backend/logs/app.log`
Expected: See "Built full video prompt", "Created full video generation task", "Full video generation completed"

- [ ] **Step 9: Document test results**

Create a test report noting:
- Video duration tested
- Number of shots
- Generation time
- Success/failure
- Any issues observed

---

## Task 14: Final Cleanup and Commit

**Files:**
- All modified files

- [ ] **Step 1: Remove commented code**

Go back to `backend/services/shotGenerationService.js` and fully delete the commented-out functions (they were kept for reference during testing).

- [ ] **Step 2: Run linter**

Run: `cd backend && npm run lint` (if available)
Run: `cd frontend && npm run lint` (if available)
Fix any linting errors

- [ ] **Step 3: Run all tests**

Run: `cd backend && npm test`
Run: `cd frontend && npm test`
Expected: All tests pass

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "refactor: complete full-video generation migration

- Replace shot-by-shot generation with single full-video generation
- Add buildFullVideoPrompt() for concatenating shot descriptions
- Remove shot generation routes, controllers, and service functions
- Update frontend to use full-video generation
- Simplify SegmentCard to preview-only
- Add unit tests for prompt building
- Update documentation

BREAKING CHANGE: Shot-by-shot generation API endpoints removed"
```

- [ ] **Step 5: Push to develop branch**

```bash
git push origin develop
```

---

## Self-Review Checklist

- [ ] **Spec coverage check**
  - ✅ buildFullVideoPrompt() implemented
  - ✅ generateSegment() modified for full-video
  - ✅ Shot generation routes removed
  - ✅ Shot generation controllers removed
  - ✅ Shot generation service functions commented/removed
  - ✅ Frontend hook updated
  - ✅ MainPage UI added
  - ✅ SegmentCard simplified
  - ✅ Analysis prompt enhanced
  - ✅ Documentation updated
  - ✅ Tests added

- [ ] **No placeholders**
  - ✅ All code blocks are complete
  - ✅ No TBD or TODO markers
  - ✅ All file paths are exact
  - ✅ All commands have expected output

- [ ] **Type consistency**
  - ✅ Function names consistent across tasks
  - ✅ Parameter names match between definition and usage
  - ✅ API endpoint paths consistent

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-01-full-video-generation.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
