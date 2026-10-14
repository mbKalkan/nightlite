// Records the README demo in the browser harness and turns it into docs/images/demo.gif.
// Needs ffmpeg on the PATH, and `npm run fixtures:large` for the ten million rows.
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const results = 'test-results/demo';
rmSync(results, { recursive: true, force: true });
const run = spawnSync(
  'npx',
  ['playwright', 'test', 'test/visual/demo.spec.ts', `--output=${results}`],
  { stdio: 'inherit', shell: true, env: { ...process.env, DEMO_VIDEO: '1' } },
);
if (run.status !== 0) process.exit(run.status ?? 1);

/** The recorded video, wherever Playwright put it. */
function findVideo(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      const found = findVideo(path);
      if (found) return found;
    } else if (name.endsWith('.webm')) {
      return path;
    }
  }
  return undefined;
}
const video = findVideo(results);
if (!video) {
  console.error('No video was recorded.');
  process.exit(1);
}

// One palette for the whole clip and only the changed part of each frame keep the GIF small;
// the first frames are the blank page.
const out = 'docs/images/demo.gif';
const filters =
  'trim=start=0.6,setpts=PTS-STARTPTS,fps=10,scale=800:-1:flags=lanczos,split[a][b];' +
  '[a]palettegen=max_colors=96:stats_mode=diff[p];' +
  '[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle';
const gif = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', video, '-vf', filters, out], {
  stdio: 'inherit',
});
if (gif.status !== 0) process.exit(gif.status ?? 1);
console.log(`Wrote ${out} (${Math.round(statSync(out).size / 1024)} KB)`);
