import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';

// Delivery layout (see also nginx.conf):
//   index.html            shell, never cached
//   assets/index-*.js     entry (src/boot.ts): about 1 kB compressed, starts the 3D chunks
//   assets/index-*.css    all styles, render-blocking on purpose so the shell paints styled
//   assets/main-*.js      the 3D application, loaded with import() after the first paint
//   assets/three-*.js     three.js; its hash only changes when the three.js imports change
//   assets/movement-*.js  the watch movement, loaded with import() when the watch is first opened
//   *.gz and _br/*        pre-compressed copies that nginx serves as they are

const isThree = (id: string): boolean => id.includes('/node_modules/three/');

/**
 * The entry only starts the loading state; everything heavy arrives through
 * import(). Vite announces static imports only, so the chunks the entry loads
 * (and their static imports) are listed in the HTML as modulepreload links. The
 * browser then fetches them in parallel with the stylesheet instead of one round
 * trip later, when the entry runs. Chunks loaded later on demand (the movement)
 * are not preloaded.
 *
 * Two properties of the split are checked on every build:
 * - The entry must not reach three.js through static imports. One stray import
 *   would silently put the whole renderer back in front of the first paint, so
 *   this fails the build.
 * - The text guide (src/ui.ts) should not reach three.js either. Otherwise it
 *   cannot replace the stage when the 3D chunk fails to load; this only warns.
 */
function asyncApp(): Plugin {
  let base = '/';
  return {
    name: 'luna:async-app',
    apply: 'build',
    configResolved(config) { base = config.base; },
    generateBundle(_options, bundle) {
      /** Name of the chunk through which `start` statically reaches three.js, if any. */
      const pathToThree = (start: string): string | undefined => {
        const seen = new Set<string>();
        const queue = [start];
        for (let name = queue.pop(); name; name = queue.pop()) {
          const chunk = bundle[name];
          if (seen.has(name) || chunk?.type !== 'chunk') continue;
          seen.add(name);
          if (Object.keys(chunk.modules).some(isThree)) return name;
          queue.push(...chunk.imports);
        }
        return undefined;
      };
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        const via = pathToThree(chunk.fileName);
        if (!via) continue;
        if (chunk.isEntry) {
          this.error(`${chunk.fileName} statically imports three.js (via ${via}). Keep src/boot.ts free of 3D imports; load them through import().`);
        }
        if (Object.keys(chunk.modules).some(id => id.endsWith('/src/ui.ts'))) {
          this.warn(`src/ui.ts reaches three.js (via ${via}): the text guide cannot be shown when the 3D chunk fails to load. Import only types from scene.ts and watch/model.ts there.`);
        }
      }
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, { bundle }) {
        const files = bundle ?? {};
        const start = Object.values(files).flatMap(file => file.type === 'chunk' && file.isEntry ? [...file.imports, ...file.dynamicImports] : []);
        const needed = new Set<string>();
        for (let name = start.pop(); name; name = start.pop()) {
          const file = files[name];
          if (needed.has(name) || file?.type !== 'chunk') continue;
          needed.add(name);
          start.push(...file.imports);
        }
        const chunks = [...needed].map(name => files[name]).flatMap(file => file.type === 'chunk' && !file.isEntry ? [file] : []);
        chunks.sort((a, b) => b.code.length - a.code.length); // start the largest download first
        return chunks.map(chunk => ({
          tag: 'link',
          attrs: { rel: 'modulepreload', crossorigin: true, href: base + chunk.fileName },
          injectTo: 'head' as const,
        }));
      },
    },
  };
}

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);
const COMPRESSIBLE = /\.(?:html|js|css|json|svg|txt|xml|webmanifest)$/;
const kB = (bytes: number): string => `${(bytes / 1000).toFixed(1).padStart(6)} kB`;

/**
 * Writes maximum-effort gzip and Brotli copies of every text file in the output
 * directory, so the web server never compresses at request time (the container
 * is limited to a quarter of a CPU core and would otherwise use a fast, weak level).
 *
 *   dist/assets/app.js      original
 *   dist/assets/app.js.gz   picked up by nginx `gzip_static`
 *   dist/_br/assets/app.js  Brotli. Same file name in a parallel tree, so stock
 *                           nginx (which has no Brotli module) still derives the
 *                           right Content-Type from the extension. See nginx.conf.
 */
function precompress(): Plugin {
  let outDir = 'dist';
  return {
    name: 'luna:precompress',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    writeBundle: {
      sequential: true,
      order: 'post',
      async handler() {
        const names = (await readdir(outDir, { recursive: true }))
          .map(name => name.replaceAll('\\', '/'))
          .filter(name => COMPRESSIBLE.test(name) && !name.startsWith('_br/'))
          .sort();
        const rows: string[] = [];
        await Promise.all(names.map(async name => {
          const source = await readFile(join(outDir, name));
          if (source.length < 512) return; // not worth a second file
          const [gz, br] = await Promise.all([
            gzipAsync(source, { level: constants.Z_BEST_COMPRESSION }),
            brotliAsync(source, { params: {
              [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
              [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
              [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
            } }),
          ]);
          const brPath = join(outDir, '_br', name);
          await mkdir(dirname(brPath), { recursive: true });
          await Promise.all([writeFile(join(outDir, `${name}.gz`), gz), writeFile(brPath, br)]);
          rows.push(`  ${name.padEnd(34)}${kB(source.length)} │ gzip: ${kB(gz.length)} │ brotli: ${kB(br.length)}`);
        }));
        console.log(`\npre-compressed for nginx (gzip_static, _br/):\n${rows.sort().join('\n')}`);
      },
    },
  };
}

export default defineConfig({
  plugins: [asyncApp(), precompress()],
  build: {
    target: 'es2022',
    // asyncApp() writes the preload links; without Vite's own preloading the
    // entry needs neither the modulepreload polyfill nor per-import dependency lists.
    modulePreload: false,
    // The three.js chunk is about 540 kB; a larger chunk means the split regressed.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: id => (isThree(id) ? 'three' : undefined),
      },
    },
  },
});
