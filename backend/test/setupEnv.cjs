const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.APP_ORIGIN = 'http://127.0.0.1:5173';
process.env.UPLOAD_BASE_DIR = '.tmp/test-uploads';
process.env.LOG_LEVEL = 'error';
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_MAX = '120';

const backendRoot = path.resolve(__dirname, '..');
const uploadRoot = path.join(backendRoot, '.tmp', 'test-uploads');

fs.mkdirSync(path.join(uploadRoot, 'videos'), { recursive: true });
fs.mkdirSync(path.join(uploadRoot, 'segments'), { recursive: true });
fs.mkdirSync(path.join(uploadRoot, 'outputs'), { recursive: true });
