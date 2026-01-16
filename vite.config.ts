import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, (process as any).cwd(), '');
  return {
    plugins: [react()],
    // Important: base: './' allows the app to run in subdirectories (like GitHub Pages)
    base: './',
    define: {
      // Polyfill process.env.API_KEY for the app usage
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
    },
  };
});
