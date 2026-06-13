import rateLimit from 'express-rate-limit';
import { Router } from 'express';

import { lookupAres } from '../services/ares.js';
import { AppError, ErrorCodes } from '../utils/errors.js';

const router = Router();

const aresLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

/** Public IČO → company lookup for signup autofill. */
router.get('/:ico', aresLimiter, async (req, res, next) => {
  try {
    const company = await lookupAres(String(req.params.ico ?? ''));
    if (!company) throw new AppError(ErrorCodes.NOT_FOUND, 'Firma podle IČO nenalezena.', 404);
    res.json({ company });
  } catch (err) {
    next(err);
  }
});

export default router;
