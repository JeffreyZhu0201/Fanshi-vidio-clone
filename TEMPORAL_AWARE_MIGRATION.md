# Doubao-Seed Temporal-Aware API Migration

## Date
2026-05-02

## Overview
Migrated Doubao-Seed video analysis from two-step API (Files upload + Responses analyze) to single-step Chat Completions API with temporal-aware video understanding.

## Motivation
Enable time-series video understanding capabilities, allowing the AI to answer temporal queries like:
- "What happens at timestamp 2:30?"
- "When does character X appear?"
- "What events occur between 1:00 and 2:00?"

## Changes Made

### 1. API Endpoint Migration
**Before**: Two-step workflow
```javascript
// Step 1: Upload video
POST /api/v3/files
→ Returns file_id

// Step 2: Analyze video
POST /api/v3/responses
Body: { fileid: "fileid://{file_id}", fps: 0.3 }
```

**After**: Single-step Chat Completions API
```javascript
POST /api/v3/chat/completions
Body: {
  model: "doubao-seed-2-0-lite-260215",
  messages: [{
    role: "user",
    content: [
      { type: "video_url", video_url: { url: "https://...", fps: "5" } },
      { type: "text", text: "分析提示词" }
    ]
  }]
}
```

### 2. FPS Configuration
- **Before**: fps=0.3 (basic frame extraction)
- **After**: fps=5 (temporal-aware sampling, default)
- **Benefit**: 16.7x more frames sampled, better temporal understanding

### 3. Video URL Format
**Before**: 
```javascript
// Upload video first, get file_id
const fileId = await uploadVideoToDoubaoSeed(videoPath);
const videoUrl = `fileid://${fileId}`;
```

**After**:
```javascript
// Construct public HTTP URL directly
const videoUrl = toAbsolutePublicUploadUrl(videoPath);
// Example: https://frp-fox.com:42734/uploads/video-abc123.mp4
```

### 4. Code Changes

#### backend/services/doubaoSeedService.js
**Removed**:
- `uploadVideoToDoubaoSeed()` function
- `axios` and `FormData` imports
- Files API integration

**Added**:
- `toAbsolutePublicUploadUrl` import from `fileService.js`
- PUBLIC_ASSET_BASE_URL validation
- Chat Completions API request structure

**Modified**:
- `analyzeVideoWithDoubaoSeed(videoUrl, prompt, options)` - Changed signature from `(fileId, prompt, options)` to `(videoUrl, prompt, options)`
- `analyzeVideoComplete()` - Now constructs public HTTP URL instead of uploading file
- `DEFAULT_FPS` - Changed from 0.3 to 5

#### backend/services/videoAnalysisService.js
**Modified**:
- Updated Doubao-Seed integration to use new API signature
- Changed fps from 0.3 to 5 in options
- Updated logging to reflect temporal-aware mode

### 5. Environment Configuration
**New Requirement**:
```bash
PUBLIC_ASSET_BASE_URL=https://frp-fox.com:42734
```

This variable is used to construct publicly accessible URLs for videos. The backend already serves the `/uploads` directory via Express static middleware:
```javascript
app.use('/uploads', express.static(UPLOAD_DIRECTORIES.root));
```

### 6. Error Handling
Added validation to ensure PUBLIC_ASSET_BASE_URL is configured:
```javascript
if (!videoUrl) {
  throw new AppError(
    'PUBLIC_ASSET_BASE_URL 未配置，Doubao-Seed 需要公网可访问的视频 URL',
    500,
    { videoPath, hint: '请在 .env 中配置 PUBLIC_ASSET_BASE_URL' }
  );
}
```

## Benefits

### 1. Temporal Understanding
- Can answer time-based queries
- Understands event sequences and timing
- Better context for scene transitions

### 2. Simplified Workflow
- Single API call instead of two-step process
- No file upload management needed
- Reduced latency (no upload wait time)

### 3. No Storage Constraints
- No 7-day file expiration
- No 512MB upload size limit (only backend upload limit applies)
- No file_id management needed

### 4. Better Frame Sampling
- 5 fps vs 0.3 fps = 16.7x more frames
- Richer temporal context for analysis
- More accurate event detection

## Breaking Changes

### 1. Environment Variable Required
- `PUBLIC_ASSET_BASE_URL` must be configured
- Videos must be accessible via public HTTP/HTTPS URLs
- Backend must serve uploads directory (already configured)

### 2. API Signature Changes
```javascript
// Before
analyzeVideoWithDoubaoSeed(fileId, prompt, options)

// After
analyzeVideoWithDoubaoSeed(videoUrl, prompt, options)
```

### 3. Unit Tests Need Updates
- `backend/__tests__/doubaoSeedService.test.js` needs updating
- Mock responses need to match Chat Completions API format
- File upload tests should be removed

## Testing Checklist

- [x] Backend service refactored
- [x] Video URL construction implemented
- [x] PUBLIC_ASSET_BASE_URL validation added
- [x] Backend server restarted successfully
- [x] Documentation updated
- [ ] Unit tests updated to match new API
- [ ] Integration testing with real Doubao-Seed API
- [ ] Verify temporal queries work correctly
- [ ] Performance comparison (old vs new API)

## Rollback Plan

If issues arise, revert to previous implementation:
1. Restore `doubaoSeedService.js` from git history (commit before 2026-05-02)
2. Restore `videoAnalysisService.js` from git history
3. Remove PUBLIC_ASSET_BASE_URL requirement
4. Restore unit tests

Git commands:
```bash
git log --oneline -- backend/services/doubaoSeedService.js
git checkout <commit-hash> -- backend/services/doubaoSeedService.js
git checkout <commit-hash> -- backend/services/videoAnalysisService.js
```

## Next Steps

1. **Update Unit Tests**: Modify `backend/__tests__/doubaoSeedService.test.js` to match new API
2. **Integration Testing**: Test with real Doubao-Seed API using actual videos
3. **Performance Benchmarking**: Compare analysis quality and speed vs old API
4. **Documentation**: Update API documentation and user guides
5. **Monitoring**: Add logging for temporal-aware analysis metrics

## References

- Doubao-Seed Chat Completions API: https://ark.cn-beijing.volces.com/api/v3/chat/completions
- Original curl example provided by user (2026-05-02)
- DOUBAO_SEED_INTEGRATION.md (updated with migration details)
- CLAUDE.md (project documentation)

## Notes

- The migration maintains backward compatibility at the user level (frontend UI unchanged)
- Provider selection still works the same way (dropdown in AnalysisDisplay)
- Gemini provider is unaffected by these changes
- The change is transparent to end users (same UI, better results)
