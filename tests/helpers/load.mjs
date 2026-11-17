// Bundle a TypeScript entry (with its relative imports) and import the result.
// esbuild ships with Vite, so the tests need no extra dependency.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

export async function loadModule(entry) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true, format: 'esm', write: false, target: 'es2022', platform: 'neutral', logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
