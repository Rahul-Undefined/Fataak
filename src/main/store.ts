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
    this.queue = this.queue.then(async () => {
      await fs.mkdir(join(this.path, '..'), { recursive: true });
      await fs.writeFile(this.tmp, text, 'utf8');
      await fs.rename(this.tmp, this.path);
    });
    return this.queue;
  }
}
