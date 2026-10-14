import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
await rm(resolve(root, 'dist'), { recursive: true, force: true });
await mkdir(resolve(root, 'dist/server'), { recursive: true });
await mkdir(resolve(root, 'dist/.openai'), { recursive: true });
const result = await build({
  entryPoints: [resolve(root, 'worker/index.ts')],
  outfile: resolve(root, 'dist/server/index.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  metafile: true,
  legalComments: 'inline',
  banner: {
    js: `/*\n${await readFile(resolve(root, 'THIRD_PARTY_NOTICES.txt'), 'utf8')}\n*/`,
  },
});
for (const [name, input] of Object.entries(result.metafile.inputs)) {
  if (/node:|@sapphire|@discordjs|mcp-server\//.test(name) || input.imports.some((i) => i.external))
    throw new Error('Unexpected runtime import in Worker bundle');
}
const manifest = JSON.parse(await readFile(resolve(root, '.openai/hosting.json'), 'utf8'));
await writeFile(
  resolve(root, 'dist/.openai/hosting.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
await writeFile(
  resolve(root, 'dist/build-evidence.json'),
  `${JSON.stringify(
    {
      bytes:
        result.metafile.outputs[resolve(root, 'dist/server/index.js')]?.bytes ??
        Object.values(result.metafile.outputs)[0].bytes,
      inputs: Object.keys(result.metafile.inputs),
      externalImports: [],
    },
    null,
    2,
  )}\n`,
);
process.stdout.write('Built self-contained browser-platform Worker ESM.\n');
