/**
 * Import this FIRST in every test file. It points the stores at a fresh temporary
 * directory (so tests never touch the real .data/), enables the demo seed the
 * tests rely on, and disables real Gemini calls unless a test injects a mock.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

export const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'campusconnect-test-'));

process.env.CAMPUSCONNECT_DATA_DIR = TEST_DATA_DIR;
process.env.CAMPUSCONNECT_DEMO_SEED = 'true';
delete process.env.ADMIN_BOOTSTRAP_EMAIL;
delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
delete process.env.GEMINI_API_KEY;

process.on('exit', () => {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

/** Creates another empty temp directory for tests that construct their own stores. */
export function makeTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusconnect-test-'));
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
