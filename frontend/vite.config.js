import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Keep the framework in its own chunk. It changes far less often than
        // application code, so a deploy does not invalidate it in the browser
        // cache along with everything else.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  test: {
    // jsdom rather than node: most of what is worth testing here eventually
    // touches the DOM, and a pure module does not mind running inside one.
    environment: 'jsdom',
    // Vite serves this app from src/, so tests live beside the code they cover
    // rather than in a parallel tree that drifts out of step with it.
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
