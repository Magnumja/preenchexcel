import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL no ambiente.');
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
export const db = drizzle(pool, { schema });
export type Database = typeof db;
