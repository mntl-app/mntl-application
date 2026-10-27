import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

export interface MntlUser {
  userId: string;
  handle: string;
  normalizedHandle: string;
  createdAt: string;
}

function isMntlUser(value: unknown): value is MntlUser {
  return typeof value === 'object' &&
    value !== null &&
    'userId' in value &&
    typeof value.userId === 'string' &&
    'handle' in value &&
    typeof value.handle === 'string' &&
    'normalizedHandle' in value &&
    typeof value.normalizedHandle === 'string' &&
    'createdAt' in value &&
    typeof value.createdAt === 'string';
}

export class MntlUserStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath = path.join(process.cwd(), 'data', 'mntl-users.json')
  ) {}

  async create(handle: string): Promise<MntlUser> {
    const operation = this.writeQueue.then(async () => {
      const cleanHandle = handle.trim().replace(/^@/, '');
      if (!/^[a-zA-Z0-9_]{3,30}$/.test(cleanHandle)) {
        throw new Error('MNTL handle must be 3-30 characters using letters, numbers, or underscores');
      }

      const users = await this.list();
      const normalizedHandle = cleanHandle.toLowerCase();
      if (users.some(user => user.normalizedHandle === normalizedHandle)) {
        throw new Error('That MNTL handle is already taken');
      }

      const user: MntlUser = {
        userId: randomUUID(),
        handle: cleanHandle,
        normalizedHandle,
        createdAt: new Date().toISOString(),
      };
      await this.write([...users, user]);
      return user;
    });
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async getById(userId: string): Promise<MntlUser | null> {
    return (await this.list()).find(user => user.userId === userId) || null;
  }

  private async list(): Promise<MntlUser[]> {
    try {
      const contents = await fs.readFile(this.filePath, 'utf8');
      const users: unknown = JSON.parse(contents);
      if (!Array.isArray(users) || !users.every(isMntlUser)) {
        throw new Error('Invalid MNTL user store');
      }
      return users;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private async write(users: MntlUser[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(users, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, this.filePath);
  }
}
