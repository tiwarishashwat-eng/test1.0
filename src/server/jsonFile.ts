/**
 * Small helpers for the file-backed JSON stores.
 *
 * Writes go to a unique temp file that is then renamed over the target, so a crash
 * mid-write never leaves a truncated file. All store operations are synchronous,
 * which makes each one atomic within a single Node process. Running several server
 * processes against the same data directory is NOT safe (last writer wins).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { resolveDataDir } from './userStore.js';

export function dataPath(fileName: string): string {
  return path.join(resolveDataDir(), fileName);
}

export function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch (err) {
    // Never silently replace a file we could not parse: keep a copy for recovery
    const backup = `${filePath}.unreadable-${Date.now()}`;
    try {
      fs.copyFileSync(filePath, backup);
    } catch {
      /* ignore */
    }
    console.error(`[Storage] Could not parse ${filePath}; a copy was saved to ${backup}.`, err);
    return null;
  }
}

export function writeJsonFileAtomic(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempPath, filePath);
}

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
