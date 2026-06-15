import rateLimit from 'express-rate-limit';
import { Router } from 'express';
import { z } from 'zod';

import { db } from '../db/client.js';
import { contactMessages } from '../db/schema/index.js';
import env from '../config/env.js';
import { generateId } from '../utils/ids.js';
import { logger } from '../utils/logger.js';
import { sendContactNotification } from '../utils/email.js';

const router = Router();

/** Public endpoint — keep it cheap and abuse-resistant. */
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  company: z.string().trim().max(200).optional().or(z.literal('')),
  message: z.string().trim().min(1).max(4000),
});

router.post('/', contactLimiter, async (req, res, next) => {
  try {
    const body = contactSchema.parse(req.body);
    const id = generateId('ctc');
    await db.insert(contactMessages).values({
      id,
      name: body.name,
      email: body.email,
      company: body.company ? body.company : null,
      message: body.message,
    });
    logger.info({ id, email: body.email, company: body.company }, '[Contact] New message');

    // Notify operators (best-effort — the message is already persisted, so a
    // mail failure must not fail the request the visitor sees).
    const recipients = env.ADMIN_EMAILS.split(',')
      .map((e) => e.trim())
      .filter(Boolean)
      .join(', ');
    if (recipients) {
      void sendContactNotification(recipients, {
        name: body.name,
        email: body.email,
        company: body.company || null,
        message: body.message,
      }).catch((err) => {
        logger.error({ id, error: err instanceof Error ? err.message : String(err) }, '[Contact] Notification e-mail failed');
      });
    }

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
