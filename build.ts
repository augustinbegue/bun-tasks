import type { BuildConfig } from 'bun';
import dts from 'bun-plugin-dts';
import { mkdir, rm } from 'fs/promises';

const defaultBuildConfig: BuildConfig = {
  entrypoints: ['./src/index.ts'],
  outdir: './dist'
}

await rm('./dist', { recursive: true, force: true });
await mkdir('./dist', { recursive: true });


const result = await Bun.build({
  ...defaultBuildConfig,
  target: 'node',
  format: 'esm',
  // splitting: true,
  // minify: true,
  sourcemap: 'external',
  plugins: [dts()],
})
