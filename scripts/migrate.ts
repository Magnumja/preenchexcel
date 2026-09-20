import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from '../src/server/db';
await migrate(db, { migrationsFolder: 'migrations' });
await pool.end();
console.log('Migrações aplicadas.');
