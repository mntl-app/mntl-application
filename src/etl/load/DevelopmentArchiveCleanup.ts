import * as fs from 'fs/promises';
import * as path from 'path';

const UPLOAD_FILE_PATTERN = /^[a-f0-9]{32}(?:\.zip)?$/i;
const ARCHIVE_FILE_PATTERN = /^[a-zA-Z0-9_-]+\.json(?:\.\d+\.tmp)?$/;

export async function clearDevelopmentArchives(
  rootDirectory = process.cwd(),
  nodeEnvironment = process.env.NODE_ENV
): Promise<number> {
  if (nodeEnvironment !== 'development') return 0;

  const managedDirectories = [
    {
      directory: path.join(rootDirectory, 'uploads'),
      shouldRemove: (name: string) => UPLOAD_FILE_PATTERN.test(name),
    },
    {
      directory: path.join(rootDirectory, 'data', 'archives'),
      shouldRemove: (name: string) => ARCHIVE_FILE_PATTERN.test(name),
    },
  ];
  let removedCount = 0;

  for (const { directory, shouldRemove } of managedDirectories) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !shouldRemove(entry.name)) continue;
      await fs.unlink(path.join(directory, entry.name));
      removedCount++;
    }
  }

  return removedCount;
}
