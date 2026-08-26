import { defineConfig } from 'vite';

// Stage A mount-only POC build.
// Classic IIFE output, single app.js + single app.css, no code splitting,
// no source maps, no runtime CDN. React/ReactDOM bundled in.
export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    minify: 'esbuild',
    lib: {
      entry: 'src/app.jsx',
      formats: ['iife'],
      name: 'KdpIntakeApp',
      fileName: () => 'app.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        chunkFileNames: 'app.js',
        assetFileNames: 'app.css',
      },
    },
  },
});
