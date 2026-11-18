// Upload, list, read, download and hide files. Files are kept permanently; "delete" only hides them.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { ADMIN_ROLES } from '@physioconnect/shared';
import { sequelize } from '../db/index.js';
import { HttpError } from '../lib/util.js';
import { asyncHandler, requireAuth } from '../middleware/index.js';
import { verifyAccessToken } from '../services/tokens.js';
import { ALLOWED, sha256File, sniff, storage, tempDir } from '../services/storage.js';
import { audit } from '../services/audit.js';

fs.mkdirSync(tempDir(), { recursive: true });
const MAX_BYTES = Math.max(...Object.values(ALLOWED).map(a => a.maxMb)) * 1024 * 1024;
const upload = multer({ dest: tempDir(), limits: { fileSize: MAX_BYTES, files: 1, fields: 10 } });

const isAdmin = user => user?.roles?.some(r => ADMIN_ROLES.includes(r));
const one = async (sql, replacements) => (await sequelize.query(sql, { replacements }))[0][0];
const publicMeta = f => ({
  id: f.id, name: f.original_name, mimeType: f.mime_type, sizeBytes: Number(f.size_bytes), sha256: f.sha256,
  purpose: f.purpose, visibility: f.visibility, linkedType: f.linked_type, linkedId: f.linked_id, createdAt: f.created_at,
  url: `/api/v1/files/${f.id}/content`,
});

export const filesRouter = Router();

filesRouter.post('/', requireAuth, (req, res, next) => upload.single('file')(req, res, err => {
  if (err?.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'file_too_large', 'This file is too large.'));
  next(err);
}), asyncHandler(async (req, res) => {
  const f = req.file;
  if (!f) throw new HttpError(400, 'file_missing', 'Attach a file in the "file" field.');
  try {
    const meta = z.object({
      purpose: z.enum(['payment_proof', 'website_media', 'document', 'exercise_video', 'avatar', 'incident', 'grievance', 'general']).default('general'),
      visibility: z.enum(['public', 'private']).default('private'),
      linkedType: z.string().max(32).optional(),
      linkedId: z.string().max(64).optional(),
    }).parse(req.body);
    // Only staff can publish files publicly (website images, videos).
    if (meta.visibility === 'public' && !isAdmin(req.user)) throw new HttpError(403, 'forbidden', 'Only staff can publish public files.');
    const rule = ALLOWED[f.mimetype];
    if (!rule || !(await sniff(f.path, f.mimetype))) throw new HttpError(415, 'file_type_not_allowed', 'Upload a JPG, PNG, WEBP, HEIC, PDF, MP4 or MOV file.');
    if (f.size > rule.maxMb * 1024 * 1024) throw new HttpError(413, 'file_too_large', `This file type can be up to ${rule.maxMb} MB.`);
    const sha = await sha256File(f.path);
    const id = crypto.randomUUID();
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.${rule.ext}`;
    const store = storage();
    await store.put(f.path, key);
    const [[row]] = await sequelize.query(`INSERT INTO files (id, owner_user_id, purpose, visibility, original_name, mime_type, size_bytes, sha256, storage_driver, storage_key, linked_type, linked_id)
      VALUES (:id, :u, :p, :v, :n, :m, :s, :h, :d, :k, :lt, :li) RETURNING *`, {
      replacements: { id, u: req.user.id, p: meta.purpose, v: meta.visibility, n: f.originalname.slice(0, 255), m: f.mimetype, s: f.size, h: sha, d: store.name, k: key, lt: meta.linkedType ?? null, li: meta.linkedId ?? null },
    });
    await audit({ actor: req.user, action: 'file.uploaded', targetType: 'file', targetId: id, after: { purpose: meta.purpose, visibility: meta.visibility, sizeBytes: f.size }, ip: req.ip });
    res.status(201).json({ file: publicMeta(row) });
  } finally {
    await fsp.unlink(f.path).catch(() => undefined); // temp copy, if it wasn't moved
  }
}));

filesRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  const all = isAdmin(req.user) && req.query.all === '1';
  const [rows] = await sequelize.query(`SELECT * FROM files WHERE hidden_at IS NULL ${all ? '' : 'AND owner_user_id = :u'}
    ${req.query.purpose ? 'AND purpose = :p' : ''} ORDER BY created_at DESC LIMIT 100`, { replacements: { u: req.user.id, p: req.query.purpose ?? null } });
  res.json({ files: rows.map(publicMeta) });
}));

// Who may read a file: anyone if public; otherwise its owner or staff.
async function readable(req) {
  const f = await one(`SELECT * FROM files WHERE id = :id`, { id: req.params.id });
  if (!f || (f.hidden_at && !isAdmin(req.user))) throw new HttpError(404, 'not_found', 'File not found.');
  if (f.visibility === 'public') return f;
  if (!req.user) throw new HttpError(401, 'unauthorized', 'Sign in to see this file.');
  if (f.owner_user_id !== req.user.id && !isAdmin(req.user)) throw new HttpError(404, 'not_found', 'File not found.');
  return f;
}
// Optional auth: public files need no token. <img> tags can pass ?token= since they can't set headers.
const optionalAuth = asyncHandler(async (req, _res, next) => {
  const h = req.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : typeof req.query.token === 'string' ? req.query.token : null;
  if (token) {
    const claims = verifyAccessToken(token);
    // Roles from the database, not the token, so revoked or newly granted staff access applies at once.
    const u = await one(`SELECT id, status FROM users WHERE id = :id`, { id: claims.sub });
    if (!u || u.status !== 'active') throw new HttpError(401, 'unauthorized', 'Sign in again.');
    const [roles] = await sequelize.query(`SELECT role FROM user_roles WHERE user_id = :id`, { replacements: { id: u.id } });
    req.user = { id: u.id, roles: roles.map(r => r.role) };
  }
  next();
});

filesRouter.get('/:id', optionalAuth, asyncHandler(async (req, res) => res.json({ file: publicMeta(await readable(req)) })));

filesRouter.get('/:id/content', optionalAuth, asyncHandler(async (req, res) => {
  const f = await readable(req);
  const download = req.query.download === '1';
  res.set({
    'Content-Type': f.mime_type,
    'Content-Length': String(f.size_bytes),
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(f.original_name)}"`,
    'Cache-Control': f.visibility === 'public' ? 'public, max-age=86400' : 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    ETag: `"${f.sha256}"`,
  });
  storage().read(f.storage_key).on('error', () => res.destroy()).pipe(res);
}));

// "Delete" = hide. The file and its record stay for future use and audits.
filesRouter.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const f = await one(`SELECT id, owner_user_id FROM files WHERE id = :id AND hidden_at IS NULL`, { id: req.params.id });
  if (!f || (f.owner_user_id !== req.user.id && !isAdmin(req.user))) throw new HttpError(404, 'not_found', 'File not found.');
  await sequelize.query(`UPDATE files SET hidden_at = now(), hidden_by = :u WHERE id = :id`, { replacements: { id: f.id, u: req.user.id } });
  await audit({ actor: req.user, action: 'file.hidden', targetType: 'file', targetId: f.id, ip: req.ip });
  res.status(204).end();
}));
