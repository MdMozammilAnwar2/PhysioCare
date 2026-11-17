import { Router } from 'express';
import { sequelize } from '../db/index.js';
import { asyncHandler } from '../middleware/index.js';

// Public reference data.
export const zonesRouter = Router();
zonesRouter.get('/', asyncHandler(async (req, res) => {
  const city = String(req.query.city || 'Patna');
  const [rows] = await sequelize.query(`SELECT z.id, z.name, z.color, z.center_lat AS lat, z.center_lng AS lng
    FROM zones z JOIN cities c ON c.id = z.city_id WHERE c.name = :city AND z.center_lat IS NOT NULL ORDER BY z.name`, { replacements: { city } });
  res.json({ city, zones: rows });
}));
