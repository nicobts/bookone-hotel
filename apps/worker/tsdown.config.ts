import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  // Internal packages are TypeScript source and get bundled in; runtime
  // dependencies stay external and are installed in the image.
  noExternal: [/^@bookone\//],
})
