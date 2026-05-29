import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';
import dts from 'vite-plugin-dts';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  root: command === 'serve' && process.env.VITEST !== 'true' ? 'examples/basic' : undefined,
  plugins: [
    command === 'serve' && cesium(),
    command === 'build' &&
      dts({
        entryRoot: 'src',
        include: ['src'],
        insertTypesEntry: true
      })
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'CesiumAnnotationEditor',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs')
    },
    assetsInlineLimit: 0,
    rollupOptions: {
      external: ['cesium'],
      output: {
        globals: {
          cesium: 'Cesium'
        },
        assetFileNames: (assetInfo) => {
          const name = assetInfo.names[0] ?? assetInfo.name ?? '';
          return name.endsWith('.css') ? 'styles.css' : 'assets/[name][extname]';
        }
      }
    },
    sourcemap: true
  }
}));
