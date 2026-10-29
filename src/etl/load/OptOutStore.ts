import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Platform } from '../../types/schemas';
import { identityKey, IdentityType } from './Identity';

const IDENTITY_TYPES: IdentityType[] = ['platform_account_id', 'handle', 'display_name'];

// People who are not MNTL users can ask not to be matched. Only identity
// fingerprints are stored, so the list itself reveals nobody.
export class OptOutStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath = path.join(process.cwd(), 'data', 'opt-outs.json')
  ) {}

  async add(platform: Platform, account: string): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      const keys = await this.keys();
      for (const type of IDENTITY_TYPES) keys.add(identityKey(type, platform, account));
      await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
      await fs.writeFile(temporaryPath, JSON.stringify([...keys]), { mode: 0o600 });
      await fs.rename(temporaryPath, this.filePath);
    });
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async keys(): Promise<Set<string>> {
    try {
      const keys: unknown = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (!Array.isArray(keys) || !keys.every(key => typeof key === 'string')) {
        throw new Error('Invalid opt-out store');
      }
      return new Set(keys);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
      throw error;
    }
  }
}
