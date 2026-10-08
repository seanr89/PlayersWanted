import { build, context } from 'esbuild';

const options = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'lib/index.js',
  sourcemap: true,
  external: ['firebase-admin', 'firebase-functions'],
};

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('esbuild watching functions/src …');
} else {
  await build(options);
}
