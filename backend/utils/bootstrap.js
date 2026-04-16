import { mkdir } from 'node:fs/promises';

import { UPLOAD_DIRECTORIES } from '../config/constants.js';

const ensureUploadDirectories = async () => {
  await Promise.all(
    Object.values(UPLOAD_DIRECTORIES).map((directory) =>
      mkdir(directory, { recursive: true })
    )
  );
};

export { ensureUploadDirectories };

