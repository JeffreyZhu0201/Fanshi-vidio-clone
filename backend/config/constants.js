import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);
const backendRoot = path.resolve(currentDirectory, '..');

export const APP_NAME = 'Fanshi Video Clone';
export const API_PREFIX = '/api';

export const UPLOAD_DIRECTORIES = Object.freeze({
  root: path.join(backendRoot, 'uploads'),
  videos: path.join(backendRoot, 'uploads', 'videos'),
  segments: path.join(backendRoot, 'uploads', 'segments'),
  outputs: path.join(backendRoot, 'uploads', 'outputs')
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

