// Regenerates the README and Marketplace screenshots in docs/images from the fixtures.
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['playwright', 'test', 'test/visual/readme.spec.ts'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, README_SCREENSHOTS: '1' },
});
process.exit(result.status ?? 1);
