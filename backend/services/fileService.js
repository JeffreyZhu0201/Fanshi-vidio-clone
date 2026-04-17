import path from 'node:path';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { UPLOAD_DIRECTORIES } from '../config/constants.js';
import env from '../config/env.js';

const normalizeRelativePath = (relativePath) => {
  return relativePath.split(path.sep).join('/').replace(/^\/+/, '').replace(/^uploads\//, '');
};

const resolveUploadPath = (relativePath) => {
  return path.join(UPLOAD_DIRECTORIES.root, normalizeRelativePath(relativePath));
};

const toRelativeUploadPath = (absoluteOrRelativePath) => {
  if (!absoluteOrRelativePath) {
    return '';
  }

  if (!path.isAbsolute(absoluteOrRelativePath)) {
    return normalizeRelativePath(absoluteOrRelativePath);
  }

  return normalizeRelativePath(path.relative(UPLOAD_DIRECTORIES.root, absoluteOrRelativePath));
};

const toPublicUploadUrl = (relativePath) => {
  return `/uploads/${toRelativeUploadPath(relativePath)}`;
};

const toAbsolutePublicUploadUrl = (relativePath) => {
  const publicUrl = toPublicUploadUrl(relativePath);
  const publicBaseUrl = env.PUBLIC_ASSET_BASE_URL || '';

  if (!publicBaseUrl) {
    return '';
  }

  return new URL(publicUrl, publicBaseUrl.endsWith('/') ? publicBaseUrl : `${publicBaseUrl}/`).toString();
};

const publicUrlToRelativePath = (publicUrl) => {
  return normalizeRelativePath(publicUrl.replace(/^\/?uploads\//, ''));
};

const ensureParentDirectory = async (absolutePath) => {
  await mkdir(path.dirname(absolutePath), { recursive: true });
};

const removeFileIfExists = async (absoluteOrRelativePath) => {
  if (!absoluteOrRelativePath) {
    return;
  }

  const absolutePath = path.isAbsolute(absoluteOrRelativePath)
    ? absoluteOrRelativePath
    : resolveUploadPath(absoluteOrRelativePath.startsWith('/uploads/')
        ? publicUrlToRelativePath(absoluteOrRelativePath)
        : absoluteOrRelativePath);

  await rm(absolutePath, {
    force: true
  });
};

const createOutputRelativePath = (directory, basename, extension = '.mp4') => {
  return normalizeRelativePath(
    path.join(directory, `${basename}-${Date.now()}-${randomUUID()}${extension}`)
  );
};

const duplicateToUploadPath = async (sourceAbsolutePath, targetRelativePath) => {
  const targetAbsolutePath = resolveUploadPath(targetRelativePath);
  await ensureParentDirectory(targetAbsolutePath);
  await copyFile(sourceAbsolutePath, targetAbsolutePath);
  return targetAbsolutePath;
};

export {
  resolveUploadPath,
  toRelativeUploadPath,
  toPublicUploadUrl,
  toAbsolutePublicUploadUrl,
  publicUrlToRelativePath,
  ensureParentDirectory,
  removeFileIfExists,
  createOutputRelativePath,
  duplicateToUploadPath
};
