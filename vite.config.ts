import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

function abVisualsAdminEntryPlugin(): Plugin {
  return {
    name: 'ab-visuals-admin-entry',
    closeBundle() {
      const distDir = path.resolve('dist');
      const indexHtmlPath = path.join(distDir, 'index.html');
      if (!fs.existsSync(indexHtmlPath)) return;

      const html = fs.readFileSync(indexHtmlPath, 'utf8');
      const marker = '<script type="module"';
      const forceScript = '<script>window.AB_FORCE_ADMIN = true;</script>\n';
      const adminHtml = html.includes(marker)
        ? html.replace(marker, `${forceScript}${marker}`)
        : html.replace('</head>', `${forceScript}</head>`);

      fs.writeFileSync(path.join(distDir, 'amit231106.html'), adminHtml, 'utf8');

      // Also emit /amit231106/index.html for hosts that resolve folder index routes
      const adminDir = path.join(distDir, 'amit231106');
      fs.mkdirSync(adminDir, { recursive: true });
      fs.writeFileSync(path.join(adminDir, 'index.html'), adminHtml, 'utf8');
    },
  };
}

export default defineConfig({
  plugins: [abVisualsAdminEntryPlugin()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    hmr: false,
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
