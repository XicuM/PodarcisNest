import { defineConfig } from 'tsup';
import fs from 'fs-extra';
import path from 'path';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/index': 'src/cli/index.ts',
    'server/app': 'src/server/app.ts',
    'slack/index': 'src/slack/index.ts',
  },
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  shims: true,
  onSuccess: async () => {
    const srcTemplates = path.resolve('src/server/templates');
    if (fs.existsSync(srcTemplates)) {
      fs.copySync(srcTemplates, path.resolve('dist/server/templates'));
      fs.copySync(srcTemplates, path.resolve('dist/cli/templates'));
      fs.copySync(srcTemplates, path.resolve('dist/templates'));
    }
  },
});
