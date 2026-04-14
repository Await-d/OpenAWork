import { connectDb, closeDb, sqliteAll } from '../db.js';

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL ?? './data/openAwork.db';
  process.env.DATABASE_URL = dbUrl;
  await connectDb();

  const rows = sqliteAll<{ key: string; value: string }>(
    `SELECT key, value FROM user_settings WHERE key IN ('providers', 'active_selection')`,
    [],
  );

  for (const r of rows) {
    console.log(`KEY: ${r.key}`);
    try {
      const parsed = JSON.parse(r.value);
      // Mask API keys for security
      if (Array.isArray(parsed)) {
        for (const p of parsed) {
          console.log(
            `  Provider: id=${p.id} type=${p.type} enabled=${p.enabled} baseUrl=${p.baseUrl} apiKey=${p.apiKey ? p.apiKey.slice(0, 8) + '***' : 'none'} apiKeyEnv=${p.apiKeyEnv ?? 'none'} models=${p.defaultModels?.length ?? 0}`,
          );
        }
      } else {
        const masked = JSON.stringify(parsed, null, 2).replace(
          /("apiKey"\s*:\s*")([^"]{8})([^"]*)(")/g,
          '$1$2***$4',
        );
        console.log(masked.slice(0, 4000));
      }
    } catch {
      console.log(r.value?.slice(0, 500));
    }
    console.log('---');
  }

  await closeDb();
}

void main().catch(console.error);
