# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a video regeneration workbench that takes an original video, analyzes it with AI, and regenerates it in different visual styles (realistic or comic-drama). The main pipeline:

1. Upload original video
2. Whole-video analysis with Gemini (plot, characters, scenes, time anchors, shots)
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
  - Gemini 2.5 Pro (video analysis via yunwu.ai)
  - Gemini Image Generation (character/scene reference images)
  - Seedance (video generation via Volcano Ark)

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

- **geminiService**: Whole-video analysis, prompt optimization. Uses shared prompt blueprints with "fixed structure + editable style section" pattern.
- **seedDanceService**: Seedance API integration. Creates remote tasks, polls for results, downloads generated videos.
- **generationService**: Full-video generation orchestration. Uses `buildFullVideoPrompt()` to concatenate all shot descriptions, expands `@character` and `#scene` mentions, collects reference assets, and generates entire video in single API call.
- **segmentService**: Video splitting into segments and shots for preview/debugging. Uses time anchors from whole-video analysis.
- **shotSpeechService**: Audio slicing, subtitle normalization, SRT generation. Speech data comes from whole-video analysis.
- **resourceImageService**: Character three-view and scene reference image generation with Gemini Image.
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

1. **Upload → Analysis**: Video uploaded → stored with hash filename → whole-video analysis with Gemini → results stored in `analyses` table with `analysis_options` (includes `styleMode` and `styleTemplates`)
2. **Analysis → Split** (optional, for preview): Time anchors from analysis → split into segments → split into shots → extract keyframes, audio clips, subtitles
3. **Resource Generation**: Characters → three-view images; Scenes → reference images (both use current style mode)
4. **Full Video Generation**: All shot descriptions concatenated via `buildFullVideoPrompt()` → single Seedance API call → complete video downloaded
5. **Download**: Generated video ready for download (no assembly needed)

### Important Constraints

- **Whole-video analysis**: Only calls Gemini once. For large videos, creates a low-res proxy video first to reduce upload size.
- **Speech extraction**: When `extractSubtitles` or `parseAudio` is enabled, shot-level `speech` is returned in whole-video analysis.
- **Full-video generation**: All shot descriptions concatenated into single prompt using `buildFullVideoPrompt()`. Format: 【风格】【角色】【场景】【分镜头】sections. Single Seedance API call generates entire video, maintaining visual consistency across all shots.
- **No shot-level generation**: Individual shots are not generated separately. No FFmpeg assembly needed.
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
- `GEMINI_API_KEY`, `GEMINI_API_BASE_URL`: Gemini API (yunwu.ai)
- `SEED_DANCE_API_KEY`, `SEED_DANCE_API_BASE_URL`: Seedance API (Volcano Ark)
- `PUBLIC_ASSET_BASE_URL`: Public URL for reference assets (required for Seedance to access reference videos)
- `HTTPS_ENABLED`, `HTTPS_PORT`, `SSL_KEY_PATH`, `SSL_CERT_PATH`: HTTPS configuration
- `GEMINI_STRICT_REMOTE`, `SEED_DANCE_STRICT_REMOTE`: When true, disables mock fallback (for production/testing)

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

- **External stability**: Gemini image generation and Seedance long tasks are subject to upstream rate limits (429) and queue delays
- **Cypress E2E**: Requires system-level Xvfb on Ubuntu 22.04
- **Mock fallback**: Disabled in strict mode (`GEMINI_STRICT_REMOTE=true`, `SEED_DANCE_STRICT_REMOTE=true`)

## API Endpoints

Key routes:
- `POST /api/videos/upload` - Upload video
- `POST /api/analysis/analyze` - Whole-video analysis
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
- **New AI providers**: Follow the pattern in `geminiService.js` and `seedDanceService.js` (external HTTP service + retry logic + error normalization)
- **Database changes**: Create migration with `sequelize-cli`, update models, run `npm run db:migrate`
- **Frontend state**: Use Zustand stores (`videoStore`, `analysisStore`, `generationStore`)
- **Media processing**: Use `ffmpegService` methods; avoid direct `child_process` calls
- **File paths**: Always use `resolveUploadPath()` and `toPublicUploadUrl()` from `fileService` for consistency

## Documentation

- [Overall Architecture](docs/Overall_Arch.md) - Detailed architecture and data flow
- [Pipeline](docs/pipeline.md) - Step-by-step pipeline documentation
- [Summary](docs/Summary0.md) - Current implementation status and real functionality
- [Contributing Guide](CONTRIBUTING.md) - Git workflow and commit conventions
- [Task Docs](docs/task/) - Stage-by-stage development tasks
