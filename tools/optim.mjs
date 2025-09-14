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
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(outPath);
}

async function main() {
  await ensureDir(outputDir);
  const files = await listPngs(inputDir);
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

