// Optional Linux headless runner using registry-packaged Chromium and NSS.
// Normal developer/CI runs can use `npx playwright install --with-deps chromium`.
import chromium from '@sparticuz/chromium';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const buildDir = dirname(require.resolve('@sparticuz/chromium'));
const { inflate } = await import(pathToFileURL(join(buildDir, 'lambdafs.js')).href);
const libraries = await inflate(join(buildDir, '../bin/al2023.tar.br'));
const executablePath = await chromium.executablePath();
// Do not use the package's --disable-web-security / --single-process defaults:
// these tests must exercise the iframe's real browser security boundary.
const args = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--no-zygote',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];
const result = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    LD_LIBRARY_PATH: `${join(libraries, 'lib')}:${process.env.LD_LIBRARY_PATH || ''}`,
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: executablePath,
    PLAYWRIGHT_CHROMIUM_ARGS: JSON.stringify(args),
  },
});
process.exit(result.status ?? 1);
