import rateLimit from 'express-rate-limit';
import { Router } from 'express';
import { z } from 'zod';

import { db } from '../db/client.js';
import { contactMessages } from '../db/schema/index.js';
import { generateId } from '../utils/ids.js';
import { logger } from '../utils/logger.js';
import { sendContactNotification } from '../utils/email.js';

const router = Router();

/** Contact-form notifications go to this single inbox only. */
const CONTACT_NOTIFY_EMAIL = 'hornakjosef@outlook.cz';

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

    // Notify the operator (best-effort — the message is already persisted, so a
    // mail failure must not fail the request the visitor sees). Contact-form
    // notifications go to a single inbox only.
    void sendContactNotification(CONTACT_NOTIFY_EMAIL, {
      name: body.name,
      email: body.email,
      company: body.company || null,
      message: body.message,
    }).catch((err) => {
      logger.error({ id, error: err instanceof Error ? err.message : String(err) }, '[Contact] Notification e-mail failed');
    });

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
