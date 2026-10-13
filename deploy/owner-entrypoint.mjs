import { readFileSync } from 'node:fs';

// The host mounts an already-approved secret. Never print paths or credentials.
try {
  const data = readFileSync('/run/secrets/discord_bot_token');
  if (data.length < 20 || data.length > 16_384) throw new Error('Invalid secret size');
  process.env.DISCORD_TOKEN = data.toString('utf8').trim();
} catch {
  process.stderr.write('Discord bot secret unavailable or invalid; server was not started.\n');
  process.exit(1);
}
await import('./dist/cli.js');
