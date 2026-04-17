import path from 'node:path';
import { fileURLToPath } from 'node:url';

import env from './env.js';

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);
const backendRoot = path.resolve(currentDirectory, '..');
const uploadRoot = env.UPLOAD_BASE_DIR
  ? path.resolve(backendRoot, env.UPLOAD_BASE_DIR)
  : path.join(backendRoot, 'uploads');

export const APP_NAME = 'Fanshi Video Clone';
export const API_PREFIX = '/api';

export const PROJECT_STATUS = Object.freeze({
  draft: 'draft',
  processing: 'processing',
  completed: 'completed',
  failed: 'failed'
});

export const VIDEO_STATUS = Object.freeze({
  uploaded: 'uploaded',
  analyzing: 'analyzing',
  analyzed: 'analyzed',
  failed: 'failed'
});

export const UPLOAD_DIRECTORIES = Object.freeze({
  root: uploadRoot,
  videos: path.join(uploadRoot, 'videos'),
  segments: path.join(uploadRoot, 'segments'),
  outputs: path.join(uploadRoot, 'outputs')
});

export const ALLOWED_VIDEO_EXTENSIONS = Object.freeze(['.mp4', '.mov', '.avi']);
export const ALLOWED_VIDEO_MIME_TYPES = Object.freeze([
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo'
]);

export const TASK_STATUS = Object.freeze({
  pending: 'pending',
  processing: 'processing',
  completed: 'completed',
  failed: 'failed'
});

export const PROJECT_STATUS_VALUES = Object.freeze(Object.values(PROJECT_STATUS));
export const VIDEO_STATUS_VALUES = Object.freeze(Object.values(VIDEO_STATUS));
export const TASK_STATUS_VALUES = Object.freeze(Object.values(TASK_STATUS));
