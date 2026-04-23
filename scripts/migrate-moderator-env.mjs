/* eslint-disable no-console */
/**
 * One-shot: MODERATOR_PUBKEYS (comma-separated base58) → User + ModeratorGrant.
 * Idempotent: skips pubkeys that already have ModeratorGrant.
 *
 *   npm run migrate:moderator-env
 *
 * Requires DATABASE_URL and optional MODERATOR_PUBKEYS in .env
 */
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFromFile(fileName, overrideExisting) {
  const full = path.join(projectRoot, fileName);
  if (!existsSync(full)) return;
  const text = readFileSync(full, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (overrideExisting || process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFromFile('.env', false);
loadEnvFromFile('.env.local', true);

const prisma = new PrismaClient();

function parsePubkeys() {
  const raw = process.env.MODERATOR_PUBKEYS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const pubkeys = parsePubkeys();
  if (pubkeys.length === 0) {
    console.log('Nothing to do: MODERATOR_PUBKEYS is empty.');
    return;
  }

  let usersCreated = 0;
  let grantsCreated = 0;
  let grantsSkipped = 0;

  for (const pubkey of pubkeys) {
    let user = await prisma.user.findUnique({ where: { pubkey }, select: { id: true } });
    if (!user) {
      user = await prisma.user.create({ data: { pubkey }, select: { id: true } });
      usersCreated += 1;
    }

    const existingGrant = await prisma.moderatorGrant.findUnique({ where: { userId: user.id } });
    if (existingGrant) {
      grantsSkipped += 1;
      continue;
    }

    await prisma.moderatorGrant.create({ data: { userId: user.id } });
    grantsCreated += 1;
  }

  console.log('migrate-moderator-env summary:', {
    pubkeys: pubkeys.length,
    usersCreated,
    grantsCreated,
    grantsSkipped,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
