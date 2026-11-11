import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { MemoryStore } from './store.js';

/**
 * Everything in one JSON file on disk, for a home computer or a small Node server. Read once at
 * start, written in full after each change (to a temporary file first, then renamed, so a power
 * cut never leaves half a file). Plenty for thousands of entries; move to D1 or a database
 * beyond that.
 */
export class FileStore extends MemoryStore {
  private writing: Promise<void> = Promise.resolve();

  private constructor(private readonly path: string) {
    super();
  }

  static async open(path: string): Promise<FileStore> {
    const store = new FileStore(path);
    try {
      const saved = JSON.parse(await readFile(path, 'utf8')) as Record<string, string>;
      for (const [key, value] of Object.entries(saved)) store.data.set(key, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return store;
  }

  override async put(key: string, value: string): Promise<void> {
    await super.put(key, value);
    await this.save();
  }

  override async delete(key: string): Promise<void> {
    await super.delete(key);
    await this.save();
  }

  private save(): Promise<void> {
    // One write at a time, in order.
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.writing`;
      await writeFile(temporary, JSON.stringify(Object.fromEntries(this.data)), 'utf8');
      await rename(temporary, this.path);
    });
    return this.writing;
  }
}
