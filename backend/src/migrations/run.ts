import fs from 'fs';
import path from 'path';
import { pool, query } from '../config/database';

async function runMigrations() {
  console.log('Starting database migrations...\n');

  try {
    // Create migrations tracking table if it doesn't exist
    await query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get list of migration files
    const migrationsDir = path.join(__dirname);
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    // Get already executed migrations
    const executed = await query<{ name: string }>('SELECT name FROM migrations');
    const executedNames = new Set(executed.map(m => m.name));

    // Run pending migrations
    for (const file of files) {
      if (executedNames.has(file)) {
        console.log(`⏭️  Skipping ${file} (already executed)`);
        continue;
      }

      console.log(`▶️  Running ${file}...`);

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      // Execute migration in a transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO migrations (name) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`✅ Completed ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`❌ Failed ${file}:`, error);
        throw error;
      } finally {
        client.release();
      }
    }

    console.log('\n✨ All migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
