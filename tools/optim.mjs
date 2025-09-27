#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const inputDir = 'src/assets/art';
const outputDir = 'src/assets/optim';

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function listPngs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.png'))
    .map((e) => e.name);
}

async function optimizePng(inPath, outPath) {
  // Lossless PNG optimization via zlib/deflate tuning.
  // compressionLevel: 0-9 (9 = max). effort: 1-10 (10 = max).
  await sharp(inPath)
    .resize({ width: 320 })
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(outPath);
}

function parseArgs(argv) {
  const args = { id: null };
  const rest = [];
  for (const a of argv.slice(2)) {
    if (a.startsWith('--id=')) args.id = a.slice('--id='.length);
    else if (a === '--id') args.id = null; // value may follow
    else if (args.id === null && rest.length && rest[rest.length - 1] === '--id') args.id = a;
    else rest.push(a);
  }
  // Fallback: allow positional id without --id
  if (!args.id && rest.length > 0 && !rest[0].startsWith('-')) args.id = rest[0];
  return args;
}

async function main() {
  const { id } = parseArgs(process.argv);
  await ensureDir(outputDir);
  let files = await listPngs(inputDir);
  if (id) {
    const target = `${id}-art.png`;
    // Prefer exact match; otherwise, try startsWith fallback for flexibility
    const exact = files.find((f) => f === target);
    const starts = files.find((f) => f.startsWith(`${id}-art`) && f.endsWith('.png'));
    const chosen = exact || starts;
    if (!chosen) {
      console.error(`No art found for id "${id}" under ${inputDir}. Expected "${target}".`);
      process.exit(2);
    }
    files = [chosen];
  }
  if (files.length === 0) {
    console.log('No PNGs found to optimize.');
    return;
  }

  console.log(`Optimizing ${files.length} PNG(s)...`);

  let count = 0;
  for (const file of files) {
    const inPath = path.join(inputDir, file);
    const outPath = path.join(outputDir, file);
    await optimizePng(inPath, outPath);
    count += 1;
    if (count % 20 === 0) console.log(`  Processed ${count}/${files.length}...`);
  }

  console.log(`Done. Wrote optimized files to ${outputDir}`);
}

main().catch((err) => {
  console.error('PNG optimization failed:', err);
  process.exit(1);
});
