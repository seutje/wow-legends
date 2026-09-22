import { cp, mkdir, rm } from 'node:fs/promises';

const output = new URL('../build/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const path of ['index.html', 'evaluation.html', 'styles.css', 'evaluation.css']) {
  await cp(new URL(`../${path}`, import.meta.url), new URL(path, output));
}
await cp(new URL('../src/', import.meta.url), new URL('src/', output), { recursive: true });
for (const directory of ['cards', 'decks']) {
  await cp(new URL(`../data/${directory}/`, import.meta.url), new URL(`data/${directory}/`, output), { recursive: true });
}
await mkdir(new URL('data/models/', output), { recursive: true });
for (const model of ['best.json', 'embeddinggemma.json']) {
  await cp(new URL(`../data/models/${model}`, import.meta.url), new URL(`data/models/${model}`, output));
}

process.stdout.write('Static site built in build/\n');
