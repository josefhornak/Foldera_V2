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
import { sendVerificationCode } from '../utils/email.js';

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

const verifySchema = z.object({
  email: z.string().email().toLowerCase(),
  code: z.string().regex(/^\d{6}$/),
});

const emailSchema = z.object({ email: z.string().email().toLowerCase() });

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1).max(200),
});

const sixDigitCode = (): string => String(Math.floor(100000 + Math.random() * 900000));
const codeExpiry = (): Date => new Date(Date.now() + 15 * 60 * 1000);

/**
 * Register: create the user as unverified and e-mail a 6-digit code. No token is
 * issued until the e-mail is verified. Re-registering an unverified e-mail just
 * refreshes the code (and password/name); a verified e-mail is a conflict.
 */
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(body.password, 12);
    const code = sixDigitCode();

    const [existing] = await db
      .select({ id: users.id, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);

    if (existing?.emailVerified) {
      throw new AppError(ErrorCodes.CONFLICT, 'Tento e-mail je už zaregistrovaný.', 409);
    }

    if (existing) {
      await db
        .update(users)
        .set({ passwordHash, name: body.name, verifyCode: code, verifyCodeExpires: codeExpiry() })
        .where(eq(users.id, existing.id));
    } else {
      await db.insert(users).values({
        id: generateId('usr'),
        email: body.email,
        passwordHash,
        name: body.name,
        emailVerified: false,
        verifyCode: code,
        verifyCodeExpires: codeExpiry(),
      });
    }

    await sendVerificationCode(body.email, body.name, code);
    res.status(202).json({ ok: true, email: body.email, needsVerification: true });
  } catch (err) {
    next(err);
  }
});

/** Verify the 6-digit code → mark verified and issue a token. */
router.post('/verify-email', authLimiter, async (req, res, next) => {
  try {
    const body = verifySchema.parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (!user || !user.verifyCode || !user.verifyCodeExpires) {
      throw new AppError(ErrorCodes.BAD_REQUEST, 'Neplatný nebo expirovaný kód.', 400);
    }
    if (user.verifyCodeExpires.getTime() < Date.now() || user.verifyCode !== body.code) {
      throw new AppError(ErrorCodes.BAD_REQUEST, 'Neplatný nebo expirovaný kód.', 400);
    }

    await db
      .update(users)
      .set({ emailVerified: true, verifyCode: null, verifyCodeExpires: null })
      .where(eq(users.id, user.id));

    const token = await signAuthToken({ userId: user.id, email: user.email });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    next(err);
  }
});

/** Resend the verification code to an unverified e-mail. */
router.post('/resend-code', authLimiter, async (req, res, next) => {
  try {
    const body = emailSchema.parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    // Always 200 (no user enumeration); only actually send for unverified users.
    if (user && !user.emailVerified) {
      const code = sixDigitCode();
      await db
        .update(users)
        .set({ verifyCode: code, verifyCodeExpires: codeExpiry() })
        .where(eq(users.id, user.id));
      await sendVerificationCode(user.email, user.name, code);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);

    const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, 'Nesprávný e-mail nebo heslo.', 401);
    }
    if (!user.emailVerified) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'E-mail zatím není ověřený. Dokončete registraci.', 403);
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
