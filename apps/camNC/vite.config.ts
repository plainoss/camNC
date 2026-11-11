import { fileURLToPath } from 'node:url';
import { cadSandboxPlugin } from './cadSandboxPlugin';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, PluginOption } from 'vite';
import checker from 'vite-plugin-checker';
// import { viteSingleFile } from 'vite-plugin-singlefile';
import devtoolsJson from 'vite-plugin-devtools-json';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import tsconfigPaths from 'vite-tsconfig-paths';

const ReactCompilerConfig = {
  target: '19',
};

// Colocated browser tests and their fixture are not routes; otherwise the router dumps their source as warnings.
export const routeFileIgnorePattern = '(?:\\.(?:test|spec)|TestFixture)\\.[cm]?[jt]sx?$';

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  const plugins: PluginOption[] = [
    devtoolsJson(),
    cadSandboxPlugin(),

    tsconfigPaths(),
    TanStackRouterVite({ target: 'react', autoCodeSplitting: true, routeFileIgnorePattern }),
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', ReactCompilerConfig], ['module:@preact/signals-react-transform']],
      },
    }),
    tailwindcss(),
    nodePolyfills({
      // For gstream-parser
      include: ['stream', '_stream_transform', 'util'],
      protocolImports: false,
      globals: {
        // Vite 8's Rolldown dep optimizer no longer injects the process shim on its own,
        // and util/readable-stream (via gcode-toolpath) read process in dev.
        process: 'dev',
      },
    }),
  ];
  // Type errors show in dev; builds skip it since CI runs check-types, and so do servers only automation looks at.
  if (command === 'serve' && !process.env.CAMNC_SKIP_TYPECHECK) {
    plugins.push(
      checker({
        typescript: true,
        // eslint: {
        //   lintCommand: 'eslint "./src/**/*.{ts,tsx}"',
        // },
      })
    );
  }
  // if (command !== 'serve') plugins.push(viteSingleFile());
  return {
    build: {
      // needed for next-qrcode
      commonjsOptions: { transformMixedEsModules: true },
    },
    plugins,
    resolve: {
      alias: {
        '@wbcnc/cad-script': fileURLToPath(new URL('../../packages/cad-script/src/browser.ts', import.meta.url)),
        // The polyfill plugin injects these imports into dependencies too, and a dependency in pnpm's global virtual
        // store can't resolve a package it doesn't declare, so point them at camNC's own copy.
        ...Object.fromEntries(
          ['buffer', 'global', 'process'].map(shim => {
            const id = `vite-plugin-node-polyfills/shims/${shim}`;
            return [id, fileURLToPath(import.meta.resolve(id))];
          })
        ),
      },
    },
    optimizeDeps: {
      // These plugin-injected/lazy imports escape the initial crawl. Discovering
      // them during a sketch forces a reload and invalidates in-flight previews.
      include: [
        'vite-plugin-node-polyfills/shims/global',
        '@preact/signals-react/runtime',
        'occt-import-js',
        '@wbcnc/cad > @salusoft89/planegcs',
      ],
      // Without it, framer-motion's circular imports (via HeroUI) run out of order in dev
      // ("Class extends value undefined").
      rolldownOptions: { output: { strictExecutionOrder: true } },
    },
    // Production headers are in public/_headers
    server: {
      // Settings API, run it with `pnpm dev:api`.
      proxy: { '/api': 'http://localhost:8787' },
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
  };
});
