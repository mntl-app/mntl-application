import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

export interface ExtractResult {
  extractPath: string;
  entries: string[];
  cleanup: () => Promise<void>;
}

export class ZipExtractor {
  private static readonly TEMP_DIR = './temp';

  static async extract(zipPath: string): Promise<ExtractResult> {
    try {
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries().map(entry => entry.entryName);

      const extractPath = path.join(this.TEMP_DIR, `extract_${Date.now()}_${Math.random().toString(36).substring(7)}`);

      await mkdir(extractPath, { recursive: true });
      zip.extractAllTo(extractPath, true);

      const cleanup = async () => {
        try {
          await unlink(zipPath);
          await fs.promises.rm(extractPath, { recursive: true, force: true });
        } catch (error) {
          console.error('Error during cleanup:', error);
        }
      };

      return {
        extractPath,
        entries,
        cleanup,
      };
    } catch (error) {
      console.error('Error extracting ZIP file:', error);
      throw error;
    }
  }

  static async extractEntry(zipPath: string, entryName: string): Promise<Buffer> {
    try {
      const zip = new AdmZip(zipPath);
      const entry = zip.getEntry(entryName);

      if (!entry) {
        throw new Error(`Entry ${entryName} not found in ZIP file`);
      }

      return entry.getData();
    } catch (error) {
      console.error('Error extracting entry from ZIP:', error);
      throw error;
    }
  }

  static getEntries(zipPath: string): string[] {
    try {
      const zip = new AdmZip(zipPath);
      return zip.getEntries().map(entry => entry.entryName);
    } catch (error) {
      console.error('Error reading ZIP entries:', error);
      throw error;
    }
  }

  static async validateZip(zipPath: string): Promise<boolean> {
    try {
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries();
      return entries.length > 0;
    } catch (error) {
      console.error('Invalid ZIP file:', error);
      return false;
    }
  }
}
