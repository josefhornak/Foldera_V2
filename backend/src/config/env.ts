import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_BASE_URL: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().default('postgres://foldera:foldera@localhost:5432/foldera_v2'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  APP_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'APP_ENCRYPTION_KEY must be 32 bytes hex (64 hex chars)')
    .optional(),

  MISTRAL_API_KEY: z.string().optional(),
  MISTRAL_API_URL: z.string().default('https://api.mistral.ai'),

  // Fallback ABRA Flexi document type (typDokl) for received invoices, used when
  // a supplier has no prior invoices to harvest a type from. Without a typDokl
  // ABRA cannot assign an internal number ("Pole 'Interní číslo' musí být
  // vyplněno"). `CF_FAKTURA_PRIJATA` is ABRA's standard "Čtení faktur" type;
  // override per deployment if the target company uses a different code.
  ABRA_DEFAULT_TYP_FAKTURY_PRIJATE: z.string().default('CF_FAKTURA_PRIJATA'),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),

  SOURCE_POLL_INTERVAL_MIN: z.coerce.number().default(5),

  // Collection email (app-provisioned mailbox on the host Postfix). The feature
  // self-detects availability by checking these paths are writable at runtime.
  COLLECTION_EMAIL_DOMAIN: z.string().default('inbox.foldera.cz'),
  POSTFIX_VIRTUAL_MAILBOXES_FILE: z.string().default('/etc/postfix/virtual_mailboxes'),
  MAILDIR_BASE: z.string().default('/var/mail/vhosts'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.issues);
  process.exit(1);
}

const env = parsed.data;
export default env;
