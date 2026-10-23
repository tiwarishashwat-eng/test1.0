/**
 * Private storage for proof-of-fix photos. Files live under <data dir>/evidence and
 * are served only through authenticated, ownership-checked API routes.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from '../shared/validation.js';
import { resolveDataDir } from './userStore.js';

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Checks the file signature so a renamed non-image is rejected. */
function matchesSignature(buf: Buffer, mime: string): boolean {
  if (mime === 'image/jpeg') return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === 'image/png') return buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

export type DecodedImage = { buffer: Buffer; mimeType: string };

/** Decodes and validates a base64 image payload. Returns an error message on failure. */
export function decodeImage(imageBase64: unknown, mimeType: unknown): DecodedImage | string {
  if (typeof imageBase64 !== 'string' || !imageBase64) return 'A photo is required.';
  if (typeof mimeType !== 'string' || !(ALLOWED_IMAGE_TYPES as readonly string[]).includes(mimeType)) {
    return 'Photo must be JPEG, PNG, or WebP.';
  }
  const base64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return 'Photo data is not valid.';
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) return 'Photo upload is empty or incomplete.';
  if (buffer.length > MAX_IMAGE_BYTES) return 'Photo must be 5MB or smaller.';
  if (!matchesSignature(buffer, mimeType)) return 'The file content does not match the declared image type (upload may be incomplete or corrupted).';
  return { buffer, mimeType };
}

function evidenceDir() {
  return path.join(resolveDataDir(), 'evidence');
}

export function saveEvidenceFile(image: DecodedImage): { id: string; sha256: string; sizeBytes: number; mimeType: string } {
  const id = `ev-${crypto.randomUUID()}`;
  const dir = evidenceDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${id}.${EXTENSIONS[image.mimeType]}`);
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, image.buffer);
  // Verify the write completed before committing it
  if (fs.statSync(temp).size !== image.buffer.length) {
    fs.rmSync(temp, { force: true });
    throw new Error('Evidence file write was incomplete');
  }
  fs.renameSync(temp, target);
  return {
    id,
    sha256: crypto.createHash('sha256').update(image.buffer).digest('hex'),
    sizeBytes: image.buffer.length,
    mimeType: image.mimeType
  };
}

export function evidenceFilePath(id: string, mimeType: string): string | null {
  if (!/^ev-[0-9a-f-]{36}$/.test(id)) return null;
  const file = path.join(evidenceDir(), `${id}.${EXTENSIONS[mimeType] ?? 'bin'}`);
  return fs.existsSync(file) ? file : null;
}
