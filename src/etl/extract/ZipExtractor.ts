import AdmZip from 'adm-zip';
import * as fs from 'fs';

// AdmZip reads the whole archive into memory, so parsed archives are cached and
// reused across platform detection, extraction, and media requests.
const MAX_CACHED_ZIPS = 2;
const zipCache = new Map<string, { mtimeMs: number; size: number; zip: AdmZip }>();

export class ZipExtractor {
  static open(zipPath: string): AdmZip {
    let stats: fs.Stats;
    try {
      stats = fs.statSync(zipPath);
    } catch (error) {
      zipCache.delete(zipPath);
      throw error;
    }

    const cached = zipCache.get(zipPath);
    zipCache.delete(zipPath);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      zipCache.set(zipPath, cached);
      return cached.zip;
    }

    const zip = new AdmZip(zipPath);
    zipCache.set(zipPath, { mtimeMs: stats.mtimeMs, size: stats.size, zip });
    if (zipCache.size > MAX_CACHED_ZIPS) {
      zipCache.delete(zipCache.keys().next().value!);
    }
    return zip;
  }

  static async delete(zipPath: string): Promise<void> {
    zipCache.delete(zipPath);
    await fs.promises.rm(zipPath, { force: true });
  }

  static async validateZip(zipPath: string): Promise<boolean> {
    try {
      return this.open(zipPath).getEntries().length > 0;
    } catch (error) {
      console.error('Invalid ZIP file:', error);
      return false;
    }
  }
}
