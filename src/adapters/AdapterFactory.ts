import { IPlatformAdapter } from './BaseAdapter';
import { InstagramAdapter } from './instagram/InstagramAdapter';
import { FacebookAdapter } from './facebook/FacebookAdapter';
import { XAdapter } from './x/XAdapter';
import { TikTokAdapter } from './tiktok/TikTokAdapter';
import { ZipExtractor } from '../etl/extract/ZipExtractor';

export class AdapterFactory {
  private static adapters: IPlatformAdapter[] = [
    new InstagramAdapter(),
    new FacebookAdapter(),
    new XAdapter(),
    new TikTokAdapter(),
  ];

  static getAdapter(zipPath: string): IPlatformAdapter | null {
    try {
      const zip = ZipExtractor.open(zipPath);
      const entries = zip.getEntries().map(entry => entry.entryName);

      for (const adapter of this.adapters) {
        if (adapter.detect(entries)) {
          return adapter;
        }
      }

      return null;
    } catch (error) {
      console.error('Error detecting platform:', error);
      return null;
    }
  }

  static getAllAdapters(): IPlatformAdapter[] {
    return [...this.adapters];
  }
}
