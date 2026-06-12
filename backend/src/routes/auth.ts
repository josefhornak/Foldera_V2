import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { db } from '../db/client.js';
import { users } from '../db/schema/index.js';
import { requireAuth, signAuthToken } from '../middleware/auth.js';
import { AppError, ErrorCodes } from '../utils/errors.js';
import { generateId } from '../utils/ids.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const registerSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(200),
});

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1).max(200),
});

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
    if (existing) throw new AppError(ErrorCodes.CONFLICT, 'Email already registered', 409);

    const passwordHash = await bcrypt.hash(body.password, 12);
    const id = generateId('usr');
    await db.insert(users).values({ id, email: body.email, passwordHash, name: body.name });

    const token = await signAuthToken({ userId: id, email: body.email });
    res.status(201).json({ token, user: { id, email: body.email, name: body.name } });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);

    const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, 'Invalid email or password', 401);
    }

    const token = await signAuthToken({ userId: user.id, email: user.email });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name, locale: users.locale })
      .from(users)
      .where(eq(users.id, req.auth!.userId))
      .limit(1);
    if (!user) throw new AppError(ErrorCodes.UNAUTHORIZED, 'User not found', 401);
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

export default router;
