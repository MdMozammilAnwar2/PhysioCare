import { Router } from 'express';
import { z } from 'zod';
import { Attribution } from '../models/index.js';
import { asyncHandler, requireAuth, validate } from '../middleware/index.js';
import { publicUser } from './auth.js';

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get('/', asyncHandler(async (req, res) => {
  const attribution = await Attribution.findByPk(req.user.id);
  res.json({ user: publicUser(req.user.model, req.user.roles), joinedVia: attribution ? { source: attribution.firstSource } : null });
}));

meRouter.patch('/', validate(z.object({
  name: z.string().trim().min(2).max(120).optional(),
  gender: z.enum(['female', 'male', 'other']).optional(),
  birthYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
  preferredLanguage: z.enum(['en', 'hi']).optional(),
}).strict()), asyncHandler(async (req, res) => {
  await req.user.model.update(req.body);
  res.json({ user: publicUser(req.user.model, req.user.roles) });
}));
