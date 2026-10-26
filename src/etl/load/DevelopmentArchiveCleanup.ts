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
      directoriesOnly: false,
    },
    {
      directory: path.join(rootDirectory, 'data', 'archives'),
      shouldRemove: (name: string) => ARCHIVE_FILE_PATTERN.test(name),
      directoriesOnly: false,
    },
    {
      directory: path.join(rootDirectory, 'data', 'media'),
      shouldRemove: (name: string) => /^[a-f0-9]{32}$/i.test(name),
      directoriesOnly: true,
    },
  ];
  let removedCount = 0;

  for (const { directory, shouldRemove, directoriesOnly } of managedDirectories) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }

    for (const entry of entries) {
      if (!shouldRemove(entry.name)) continue;
      if (entry.isFile()) {
        if (directoriesOnly) continue;
        await fs.unlink(path.join(directory, entry.name));
      } else if (entry.isDirectory()) {
        if (!directoriesOnly) continue;
        await fs.rm(path.join(directory, entry.name), { recursive: true });
      } else {
        continue;
      }
      removedCount++;
    }
  }

  return removedCount;
}
