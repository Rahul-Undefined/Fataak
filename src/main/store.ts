import { promises as fs } from 'node:fs';
import { join } from 'node:path';

/** Small atomic JSON file store (write temp + rename) in the app's userData folder. */
export class JsonStore<T> {
  private path: string;
  private tmp: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    dir: string,
    name: string,
    private validate: (raw: unknown) => T,
    private fallback: () => T,
  ) {
    this.path = join(dir, name);
    this.tmp = join(dir, `${name}.tmp`);
  }

  async read(): Promise<T> {
    try {
      const text = await fs.readFile(this.path, 'utf8');
      return this.validate(JSON.parse(text));
    } catch {
      return this.fallback();
    }
  }

  write(value: T): Promise<void> {
    const text = JSON.stringify(value);
    // a failed write must not block the ones after it, so the chain continues past a rejection
    this.queue = this.queue.catch(() => undefined).then(async () => {
      await fs.mkdir(join(this.path, '..'), { recursive: true });
      await fs.writeFile(this.tmp, text, 'utf8');
      await renameWithRetry(this.tmp, this.path);
    });
    return this.queue;
  }
}

/** Windows refuses a rename while an antivirus or indexer briefly holds the target (EPERM/EBUSY); wait and try again. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw e;
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
    }
  }
}
