// Permanent file store. "local" writes under STORAGE_DIR (development and single-server use);
// an S3-compatible driver can be added behind the same three functions without changing callers.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { config } from '../config/index.js';

const local = {
  name: 'local',
  // Moves a finished temp upload into place and returns its storage key.
  async put(tempPath, key) {
    const dest = path.join(config.storage.dir, key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.rename(tempPath, dest).catch(async () => { await fsp.copyFile(tempPath, dest); await fsp.unlink(tempPath); });
  },
  read(key) { return fs.createReadStream(path.join(config.storage.dir, key)); },
  async exists(key) { return fsp.access(path.join(config.storage.dir, key)).then(() => true, () => false); },
};

export const storage = () => {
  if (config.storage.driver === 'local') return local;
  throw new Error(`Storage driver "${config.storage.driver}" is not configured`);
};

export const tempDir = () => path.join(config.storage.dir, '.tmp');

export async function sha256File(file) {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), h);
  return h.digest('hex');
}

// What we accept, by real content (magic bytes), not by the name the client sends.
export const ALLOWED = {
  'image/jpeg': { ext: 'jpg', maxMb: 15, sniff: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', maxMb: 15, sniff: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', maxMb: 15, sniff: b => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'image/heic': { ext: 'heic', maxMb: 15, sniff: b => b.subarray(4, 8).toString() === 'ftyp' && /heic|heix|mif1/.test(b.subarray(8, 12).toString()) },
  'application/pdf': { ext: 'pdf', maxMb: 25, sniff: b => b.subarray(0, 5).toString() === '%PDF-' },
  'video/mp4': { ext: 'mp4', maxMb: 200, sniff: b => b.subarray(4, 8).toString() === 'ftyp' },
  'video/quicktime': { ext: 'mov', maxMb: 200, sniff: b => b.subarray(4, 8).toString() === 'ftyp' || b.subarray(4, 8).toString() === 'moov' },
};

export async function sniff(file, mime) {
  const rule = ALLOWED[mime];
  if (!rule) return false;
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(16);
    await fh.read(buf, 0, 16, 0);
    return rule.sniff(buf);
  } finally { await fh.close(); }
}
