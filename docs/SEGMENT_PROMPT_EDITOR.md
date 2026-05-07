# Segment Prompt Editor Feature

## Overview

This feature adds an editable prompt box below each segment card, allowing users to manually edit and generate segment-level videos using the Seedance API.

## Implementation Date

2026-05-08

## Key Features

### 1. Editable Prompt Box
- Located below each segment card in the UI
- Pre-populated with structured prompt format: 【风格】【角色】【场景】【分镜头】
- Uses `@ID` references for characters and scenes (NOT expanded)
- Concatenates all shots within the segment

### 2. Prompt Format

```
【风格】真人写实电影风格，真实演员质感，真实场景实景...

【角色】@2595f9ad-bb4b-462e-b199-c0fd361d88c5露西、@2fa4151a-ab81-4f9d-8240-67f932be5ba5杰森

【场景】礼堂外区域、@a61f7969-a1a3-4510-8434-1258595ee216礼堂入口区域

【分镜头】
【0-4秒】镜头1：大全景，缓慢推进。画面：@2595f9ad-bb4b-462e-b199-c0fd361d88c5在@a61f7969-a1a3-4510-8434-1258595ee216前... 动作：... 对白口型指导：...

【4-8秒】镜头2：中景，固定镜头。画面：... 动作：... 对白口型指导：...
```

### 3. UI Components

#### Prompt Editor Section
- **Location**: Below the main segment card, above the modal sheet
- **Components**:
  - Header with title and description
  - "重新生成" button - Regenerates prompt from current segment data
  - "生成片段视频" button - Triggers Seedance generation
  - Large textarea for editing the prompt
  - Help section with tips about @ID references

#### Buttons
1. **重新生成 (Regenerate)**
   - Rebuilds the prompt using `buildSegmentPromptWithReferences()`
   - Useful when segment shots are updated
   - Shows banner message: "提示词已重新生成"

2. **生成片段视频 (Generate Segment Video)**
   - Sends prompt + original video + three-view images to Seedance
   - Disabled when Seedance is not ready or prompt is empty
   - Shows generation status in button label

### 4. Technical Implementation

#### Files Modified
- `frontend/src/components/SegmentCard.jsx`
  - Added import: `buildSegmentPromptWithReferences` from `shared/segmentPromptBuilder.js`
  - Added state: `segmentPrompt` for storing edited prompt
  - Added useEffect: Initializes prompt when segment changes
  - Added handler: `handleGenerateSegmentVideo()` for generation
  - Added UI section: Prompt editor with textarea and buttons

#### Files Created
- `shared/segmentPromptBuilder.js`
  - `buildSegmentPromptWithReferences()` - Main function
  - `buildStyleSection()` - Builds 【风格】section
  - `buildCharacterSectionWithReferences()` - Builds 【角色】with @ID
  - `buildSceneSectionWithReferences()` - Builds 【场景】with @ID/#ID
  - `buildShotsSection()` - Builds 【分镜头】with all shots

#### State Management
```javascript
const [segmentPrompt, setSegmentPrompt] = useState('');

useEffect(() => {
  const initialPrompt = buildSegmentPromptWithReferences({
    segment: {
      ...segment,
      analysis: { shots: segment.shots ?? [] }
    },
    analysis: overallAnalysis,
    styleMode: currentStyleMode
  });
  setSegmentPrompt(initialPrompt);
}, [segment.id, segment.shots, overallAnalysis, currentStyleMode]);
```

#### Generation Handler
```javascript
const handleGenerateSegmentVideo = () => {
  if (!segmentPrompt.trim()) {
    setEditorBanner('请先编辑片段提示词');
    return;
  }

  if (!canStartGeneration) {
    setEditorBanner(seedDanceUnavailableReason);
    return;
  }

  return onGenerate(segment.id, segmentPrompt, {
    useReferenceVideo: true, // Always use reference video
    useRepresentativeFrame: useReferenceFrame
  });
};
```

## Usage Flow

1. **User uploads video** → Analysis extracts segments and shots
2. **Segment card displays** → Prompt editor appears below each segment
3. **Prompt auto-generated** → Uses `buildSegmentPromptWithReferences()`
4. **User edits prompt** → Can modify any part of the structured prompt
5. **User clicks "生成片段视频"** → Sends to Seedance API
6. **Seedance generates** → Returns video for the segment
7. **Video displays** → Shows in segment preview area

## Key Constraints

### Segment Duration
- Maximum 15 seconds per segment
- System automatically concatenates all shots within segment
- Longer segments may need to be split

### Reference Format
- Characters: `@characterID角色名` (e.g., `@2595f9ad露西`)
- Scenes: `@sceneID场景名` or `#sceneID场景名`
- IDs are NOT expanded to full descriptions in this prompt
- Expansion happens server-side during generation

### Generation Requirements
- **Prompt**: Edited segment prompt (required)
- **Original Video**: Always included (`useReferenceVideo: true`)
- **Three-view Images**: Character turnaround images (single image with 3 angles)
- **Scene Reference Images**: Background/scene reference images
- **Representative Frame**: Optional, controlled by toggle

## API Integration

### Generation Request
```javascript
onGenerate(segment.id, segmentPrompt, {
  useReferenceVideo: true,
  useRepresentativeFrame: useReferenceFrame
});
```

### Backend Processing
1. Receives segment ID and edited prompt
2. Collects reference assets:
   - Original segment video
   - Character three-view images
   - Scene reference images
   - Optional representative frame
3. Sends to Seedance API
4. Polls for completion
5. Returns generated video URL

## User Experience

### Visual Feedback
- **Banner messages**: Show status (regenerated, generating, errors)
- **Button states**: Disabled when not ready or generating
- **Tooltips**: Explain what each button does
- **Help section**: Tips about @ID references and constraints

### Error Handling
- Empty prompt: "请先编辑片段提示词"
- Seedance not ready: Shows reason (e.g., "缺少必要配置")
- Generation failure: Handled by parent component

## Future Enhancements

### Potential Improvements
1. **Prompt validation**: Check format before generation
2. **Preview expansion**: Show what @ID references will expand to
3. **Template library**: Save and reuse prompt templates
4. **Batch generation**: Generate multiple segments at once
5. **Segment concatenation**: Automatically merge generated segments into final video

### Known Limitations
1. No real-time preview of expanded references
2. No validation of @ID references (may reference non-existent IDs)
3. No automatic segment splitting if duration > 15 seconds
4. No undo/redo for prompt edits

## Testing

### Manual Testing Checklist
- [ ] Prompt auto-generates when segment loads
- [ ] "重新生成" button refreshes prompt correctly
- [ ] Textarea allows editing
- [ ] "生成片段视频" button triggers generation
- [ ] Button disables when Seedance not ready
- [ ] Banner shows appropriate messages
- [ ] Generated video displays in segment preview
- [ ] @ID references preserved (not expanded) in textarea

### Edge Cases
- Empty segment (no shots)
- Segment with no characters
- Segment with no scenes
- Very long segment (>15 seconds)
- Invalid @ID references

## Related Documentation

- [Segment Prompt Builder](../shared/segmentPromptBuilder.js) - Prompt building logic
- [CLAUDE.md](../CLAUDE.md) - Project overview and architecture
- [Audio Analysis Design](./superpowers/specs/2026-05-07-audio-analysis-segment-generation-design.md) - Original design spec

## Commit History

- `b9bbc55` - feat(frontend): add editable segment prompt box with @ID references
- `da18012` - feat(generation): add segment-level video generation with buildSegmentVideoPrompt
- `c22526a` - feat(prompts): implement buildSegmentVideoPrompt with resource expansion

## Notes

- This feature does NOT implement automatic segment-level generation
- User explicitly requested editable prompt box instead of automatic generation
- The prompt uses @ID references (not expanded) for better editability
- Three-view images are single images containing three angles of each character
- Final video assembly (concatenating segments) is a separate future feature
