# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a video regeneration workbench that takes an original video, analyzes it with AI, and regenerates it in different visual styles (realistic or comic-drama). The main pipeline:

1. Upload original video
2. Whole-video analysis with AI provider (Gemini 2.5 Pro or Doubao-Seed)
3. Generate character three-view images and scene reference images
4. Concatenate all shot descriptions into single prompt
5. Generate full video with single Seedance API call
6. Download complete video (no assembly needed)

## Architecture

### Tech Stack
- **Frontend**: React + Vite + Tailwind CSS + Zustand
- **Backend**: Node.js + Express + Sequelize + MySQL
- **Media Processing**: FFmpeg/FFprobe
- **AI Services**: 
  - **Video Analysis**: Gemini 2.5 Pro (via yunwu.ai) or Doubao-Seed (via Volcano Ark)
  - **Image Generation**: 
    - Gemini Image Generation (scene reference images, character portraits)
    - Doubao-Seedream (character three-view/turnaround images)
  - **Video Generation**: Seedance (via Volcano Ark)

### Directory Structure
```
backend/
  ├── routes/          # HTTP endpoints
  ├── controllers/     # Request/response handlers
  ├── services/        # Core business logic
  ├── models/          # Sequelize models
  ├── migrations/      # Database migrations
  ├── utils/           # Logging, validation, bootstrap
  └── uploads/         # Local media storage

frontend/src/
  ├── pages/           # Page components
  ├── components/      # UI components
  ├── hooks/           # React hooks for API calls
  ├── services/        # API client wrappers
  ├── store/           # Zustand state management
  └── utils/           # Frontend utilities

shared/
  ├── styleTemplates.js      # Style mode definitions (realistic/comic_drama)
  └── promptBlueprints.js    # Prompt construction templates
```

### Key Services (Backend)

- **videoAnalysisService**: Multi-provider video analysis orchestration. Supports Gemini and Doubao-Seed providers with unified interface. Includes intelligent segment merging logic that consolidates adjacent same-scene segments.
- **geminiService**: Gemini 2.5 Pro video analysis, prompt optimization. Uses shared prompt blueprints with "fixed structure + editable style section" pattern.
- **doubaoSeedService**: Doubao-Seed video analysis integration. Two-step API flow: Files API (upload) → Responses API (analyze with audio). Extracts voiceProfile for speaking characters.
- **doubaoSeedreamService**: Doubao-Seedream integration for character three-view (turnaround) image generation. Uses same ARK API key as Seedance.
- **seedDanceService**: Seedance API integration. Creates remote tasks, polls for results, downloads generated videos.
- **generationService**: Full-video and segment-level generation orchestration. Uses `buildFullVideoPrompt()` or `buildSegmentVideoPrompt()` to construct prompts, expands `@character` and `#scene` mentions (including voiceProfile), collects reference assets, and generates video via Seedance API.
- **segmentService**: Video splitting into segments and shots for preview/debugging. Uses time anchors from whole-video analysis.
- **shotSpeechService**: Audio slicing, subtitle normalization, SRT generation. Speech data comes from whole-video analysis.
- **resourceImageService**: Character and scene reference image generation. Routes character turnarounds to Doubao-Seedream, other types to Gemini Image.
- **ffmpegService**: Video slicing, frame extraction, audio processing.
- **taskRecoveryService**: Recovers in-flight generation tasks after backend restart.

### Style System

The project uses a shared style template system (`shared/styleTemplates.js`) with two modes:
- `realistic`: Realistic cinematic style
- `comic_drama`: Chinese comic-drama style (国漫影视化)

Style templates affect:
- Whole-video analysis prompts
- Segment analysis prompts
- Character/scene reference image generation
- Prompt optimization
- Final video generation prompts

Only `videoAnalysisStylePrompt` and `segmentAnalysisStylePrompt` are user-editable. Other style blocks (character/scene/video generation) follow presets.

### Data Flow

1. **Upload → Analysis**: Video uploaded → stored with hash filename → whole-video analysis with selected AI provider (Gemini or Doubao-Seed) → results stored in `analyses` table with `analysis_options` (includes `styleMode` and `styleTemplates`). Doubao-Seed extracts voiceProfile for speaking characters from audio.
2. **Segment Merging**: Adjacent segments with same `sceneId` are automatically merged to avoid over-segmentation. Merging happens after AI analysis, before saving to database.
3. **Analysis → Split** (optional, for preview): Time anchors from analysis → split into segments → split into shots → extract keyframes, audio clips, subtitles
4. **Resource Generation**: Characters → three-view images; Scenes → reference images (both use current style mode)
5. **Segment-Level Generation**: Individual segments can be generated using `buildSegmentVideoPrompt()` which expands `@character` (including voiceProfile) and `#scene` references, concatenates all shots in the segment, and generates via single Seedance API call.
6. **Full Video Generation**: All shot descriptions concatenated via `buildFullVideoPrompt()` → single Seedance API call → complete video downloaded
7. **Download**: Generated video ready for download (no assembly needed)

### Important Constraints

- **Multi-provider video analysis**: Supports both Gemini 2.5 Pro and Doubao-Seed for whole-video analysis. Users can select provider in the frontend UI.
- **Doubao-Seed workflow**: Two-step API flow - Files API uploads video (max 512MB, 7-day storage), Responses API analyzes with fps=0.3 frame extraction and audio analysis enabled.
- **Audio analysis**: When using Doubao-Seed, voiceProfile (timbre, tone, pace, emotion, intensity, articulation, summary) is extracted for speaking characters. Displayed in frontend character cards.
- **Segment merging**: Adjacent segments with same `sceneId` are automatically merged after analysis to prevent over-segmentation. Uses `mergeAdjacentSegments()` in `analysisService.js`.
- **Whole-video analysis**: Only calls AI provider once. For large videos (Gemini), creates a low-res proxy video first to reduce upload size.
- **Speech extraction**: When `extractSubtitles` or `parseAudio` is enabled, shot-level `speech` is returned in whole-video analysis.
- **Segment-level generation**: Segments can be generated individually using `buildSegmentVideoPrompt()`. Expands `@character` (with voiceProfile) and `#scene` references, concatenates shots, generates via Seedance.
- **Full-video generation**: All shot descriptions concatenated into single prompt using `buildFullVideoPrompt()`. Format: 【风格】【角色】【场景】【分镜头】sections. Single Seedance API call generates entire video, maintaining visual consistency across all shots.
- **Resource expansion**: `@characterID` expands to full character description including voiceProfile. `#sceneID` expands to full scene description.
- **Character state continuity**: Managed by `stateTimeline` and `characterStateRefs` from whole-video analysis, embedded in concatenated prompt.

## Common Development Commands

### Backend
```bash
cd backend

# Development
npm run dev              # Start with nodemon

# Database
npm run db:check         # Check database connection
npm run db:init          # Initialize database schema
npm run db:migrate       # Run migrations
npm run db:seed          # Seed data

# Testing
npm test                 # Run tests
npm run test:coverage    # Run tests with coverage

# Smoke Tests
npm run ai:smoke         # Test Gemini/Seedance connectivity
npm run pipeline:smoke   # Test full pipeline (upload → analysis → split → optimize → generate → merge)

# Performance
npm run perf:benchmark   # Run performance benchmarks
```

### Frontend
```bash
cd frontend

# Development
npm run dev              # Start Vite dev server
npm run dev:test         # Start in test mode (for E2E)

# Build
npm run build            # Production build
npm run preview          # Preview production build

# Testing
npm test                 # Run Jest tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage
npm run test:e2e         # Run Cypress E2E tests
```

### Full Stack
```bash
# Generate local HTTPS certificates
./scripts/generate-dev-ssl.sh

# Pre-deployment checks
./scripts/preflight-check.sh
```

## Environment Configuration

### Backend (.env)
Key variables:
- `DB_*`: MySQL connection (host, port, user, password, database name)
- `GEMINI_API_KEY`, `GEMINI_API_BASE_URL`: Gemini API (yunwu.ai) for video analysis and image generation
- `SEED_DANCE_API_KEY`, `SEED_DANCE_API_BASE_URL`: Seedance API (Volcano Ark) for video generation. Also used as ARK_API_KEY for Doubao-Seed video analysis and Doubao-Seedream image generation
- `PUBLIC_ASSET_BASE_URL`: Public URL for reference assets (required for Seedance to access reference videos)
- `HTTPS_ENABLED`, `HTTPS_PORT`, `SSL_KEY_PATH`, `SSL_CERT_PATH`: HTTPS configuration
- `GEMINI_STRICT_REMOTE`, `SEED_DANCE_STRICT_REMOTE`: When true, disables mock fallback (for production/testing)

**Note**: Doubao-Seed and Doubao-Seedream both use the same `SEED_DANCE_API_KEY` (ARK API key) as Seedance, since all three services are provided by Volcano Ark.

### Frontend (.env)
Key variables:
- `VITE_API_BASE_URL`: API base URL (usually `/api` for proxy)
- `VITE_API_PROXY_TARGET`: Backend URL for Vite proxy
- `VITE_DEV_HTTPS`: Enable HTTPS in dev mode
- `VITE_SSL_KEY_PATH`, `VITE_SSL_CERT_PATH`: HTTPS certificates

## Key Implementation Details

### Prompt Construction Pattern
Analysis prompts use a two-part structure:
1. **Fixed structure section**: JSON schema, field requirements, time rules (read-only)
2. **Style section**: Natural language style constraints (user-editable)

Users can only edit the style section. The JSON skeleton is locked to ensure consistent output format.

### Full-Video Generation
The system generates the entire video in a single API call:
1. **Concatenate prompts**: `buildFullVideoPrompt()` combines all shot descriptions into structured format
2. **Prompt format**: 【风格】style constraints, 【角色】character list, 【场景】scene list, 【分镜头】shot-by-shot descriptions with timing
3. **Single API call**: One Seedance request generates complete video matching original duration
4. **Visual consistency**: Single generation maintains consistent character appearance and scene aesthetics across all shots
5. **No assembly**: Downloaded video is complete and ready to use

### Reference Asset Priority
When generating full video:
1. Character three-view images (define character appearance)
2. Scene reference images (define scene/set appearance)
3. Style templates (define visual aesthetic)
4. Concatenated shot descriptions (define action, dialogue, and timing)

### Task Recovery
On backend restart, `taskRecoveryService` automatically:
- Resumes polling for in-flight Seedance tasks
- Does NOT re-submit failed tasks (requires manual retry)

## Testing Strategy

- **Backend unit tests**: Service-level logic, mocking external APIs
- **Frontend component tests**: React Testing Library + Jest
- **E2E tests**: Cypress (requires Xvfb on headless Linux)
- **Smoke tests**: Real API connectivity checks (`ai:smoke`, `pipeline:smoke`)
- **Performance benchmarks**: `perf:benchmark` script

## Git Workflow

- **Stable branch**: `main`
- **Integration branch**: `develop`
- **Feature branches**: `feature/*`
- **Bugfix branches**: `bugfix/*`
- **Hotfix branches**: `hotfix/*`

Development flow:
1. Branch from `develop`
2. Develop and self-test on feature branch
3. Merge back to `develop`
4. After stage validation, merge `develop` to `main`

Commit message format: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`)

## Known Limitations

- **External stability**: Gemini/Doubao-Seed video analysis, Gemini/Doubao-Seedream image generation, and Seedance long tasks are subject to upstream rate limits (429) and queue delays
- **Doubao-Seed constraints**: Max 512MB video file size, 7-day file storage, fps=0.3 frame extraction
- **Reference image accessibility**: Doubao-Seedream requires publicly accessible reference image URLs. FRP tunnel or local URLs may not work.
- **Cypress E2E**: Requires system-level Xvfb on Ubuntu 22.04
- **Mock fallback**: Disabled in strict mode (`GEMINI_STRICT_REMOTE=true`, `SEED_DANCE_STRICT_REMOTE=true`)

## API Endpoints

Key routes:
- `POST /api/videos/upload` - Upload video
- `POST /api/analysis/analyze` - Whole-video analysis (supports `provider` parameter: 'gemini' or 'doubao-seed')
- `POST /api/analysis/optimize-prompt` - Optimize prompts
- `POST /api/segments/split` - Split into segments/shots (for preview/debugging)
- `POST /api/resource-images/generate` - Generate character/scene reference images
- `POST /api/generation/generate` - Generate full video (single API call)
- `GET /api/generation/:taskId` - Query generation task status
- `GET /api/generation/:taskId/download` - Download generated video

API docs: `/api-docs` (Swagger UI)

## When Working on This Codebase

- **Style changes**: Modify `shared/styleTemplates.js` for preset templates, or update user-editable templates via frontend UI
- **Prompt changes**: Edit `shared/promptBlueprints.js` for fixed structure sections
- **Video analysis providers**: Two providers available - Gemini 2.5 Pro (via `geminiService.js`) and Doubao-Seed (via `doubaoSeedService.js`). Both use `videoAnalysisService.js` for unified interface. Users select provider in frontend dropdown.
- **Image generation routing**: Character turnarounds use `doubaoSeedreamService.js`, other image types use `geminiService.js`. Routing logic is in `resourceImageService.js`.
- **New AI providers**: Follow the pattern in `geminiService.js`, `doubaoSeedService.js`, `doubaoSeedreamService.js`, and `seedDanceService.js` (external HTTP service + retry logic + error normalization)
- **Database changes**: Create migration with `sequelize-cli`, update models, run `npm run db:migrate`
- **Frontend state**: Use Zustand stores (`videoStore`, `analysisStore`, `generationStore`)
- **Media processing**: Use `ffmpegService` methods; avoid direct `child_process` calls
- **File paths**: Always use `resolveUploadPath()` and `toPublicUploadUrl()` from `fileService` for consistency. For Doubao-Seedream reference images, use `toAbsolutePublicUploadUrl()` to ensure external accessibility.

## Documentation

- [Overall Architecture](docs/Overall_Arch.md) - Detailed architecture and data flow
- [Pipeline](docs/pipeline.md) - Step-by-step pipeline documentation
- [Summary](docs/Summary0.md) - Current implementation status and real functionality
- [Project Completion Summary](docs/PROJECT_COMPLETION_SUMMARY.md) - Final project status and achievements
- [Seedream Integration](SEEDREAM_INTEGRATION.md) - Doubao-Seedream integration details
- [Seedream Integration Status](SEEDREAM_INTEGRATION_STATUS.md) - Current integration status and known issues
- [Deployment Guide](docs/DEPLOYMENT.md) - Production deployment instructions
- [Operations Manual](docs/OPERATIONS.md) - System operations and maintenance
- [Contributing Guide](CONTRIBUTING.md) - Git workflow and commit conventions
- [Task Docs](docs/task/) - Stage-by-stage development tasks
