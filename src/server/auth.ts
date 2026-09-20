import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db';
import * as schema from './schema';
if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32)
  throw new Error('Configure BETTER_AUTH_SECRET com ao menos 32 caracteres.');
// Em desenvolvimento, localhost e 127.0.0.1 são a mesma origem para a pessoa que abre o navegador.
const origin = process.env.APP_ORIGIN || 'http://localhost:5173';
export const allowedOrigins =
  process.env.NODE_ENV === 'production'
    ? [origin]
    : [
        ...new Set([
          origin,
          origin.replace('localhost', '127.0.0.1'),
          origin.replace('127.0.0.1', 'localhost'),
        ]),
      ];
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: allowedOrigins,
  advanced: { ipAddress: { ipAddressHeaders: ['x-forwarded-for'] } },
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  rateLimit: { enabled: true, window: 60, max: 30 },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
});
