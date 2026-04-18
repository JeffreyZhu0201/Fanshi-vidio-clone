import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import multer from 'multer';

import env from '../config/env.js';
import {
  ALLOWED_VIDEO_EXTENSIONS,
  ALLOWED_VIDEO_MIME_TYPES,
  UPLOAD_DIRECTORIES
} from '../config/constants.js';
import { AppError } from './errorHandler.js';

const createHashedUploadFilename = (file) => {
  const originalExtension = path.extname(file.originalname).toLowerCase();
  const safeExtension = ALLOWED_VIDEO_EXTENSIONS.includes(originalExtension)
    ? originalExtension
    : '.mp4';
  const hashSeed = [
    file.originalname,
    file.mimetype,
    Date.now(),
    randomUUID()
  ].join('::');
  const hashedFilename = createHash('sha256').update(hashSeed).digest('hex');

  return `${hashedFilename}${safeExtension}`;
};

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, UPLOAD_DIRECTORIES.videos);
  },
  filename: (_request, file, callback) => {
    callback(null, createHashedUploadFilename(file));
  }
});

const fileFilter = (_request, file, callback) => {
  const extension = path.extname(file.originalname).toLowerCase();
  const isExtensionAllowed = ALLOWED_VIDEO_EXTENSIONS.includes(extension);
  const isMimeAllowed = ALLOWED_VIDEO_MIME_TYPES.includes(file.mimetype);

  if (!isExtensionAllowed || !isMimeAllowed) {
    callback(
      new AppError('Unsupported video format. Allowed formats: mp4, mov, avi.', 400, {
        mimetype: file.mimetype,
        extension
      })
    );
    return;
  }

  callback(null, true);
};

const uploadVideo = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: env.FILE_UPLOAD_LIMIT
  }
});

export { createHashedUploadFilename, uploadVideo };
