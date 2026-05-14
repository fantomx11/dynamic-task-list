const { build } = require('esbuild');
const { GasPlugin } = require('esbuild-gas-plugin');

build({
  entryPoints: ['src/Server.ts'],
  bundle: true,
  outfile: 'dist/Code.js',
  format: 'iife',
  plugins: [GasPlugin],
}).catch(() => process.exit(1));