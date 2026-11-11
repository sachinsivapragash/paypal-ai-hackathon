// Assembles the final demo video from the recording + your voice clips.
//   node scripts/assemble-video.js
// Inputs (in video/): main.webm, popup.webm, scenes.json, and optional voice clips in video/audio/
// named by scene number: 01.m4a, 02.mp3, ... (any format ffmpeg reads: mp3, m4a, wav, ogg, webm, aac).
// Output: video/final.mp4 (1280x720, H.264 + AAC) and video/scene-lengths.txt. Dev tool only.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const FF = require('ffmpeg-static');

const DIR = path.join(__dirname, '..', 'video');
const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'scenes.json'), 'utf8'));
const run = (args) => execFileSync(FF, ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const duration = (file) => {
  const out = (() => { try { return execFileSync(FF, ['-i', file], { stdio: ['ignore', 'pipe', 'pipe'] }).toString(); } catch (e) { return String(e.stderr); } })();
  const m = out.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
};
const tmp = path.join(DIR, 'tmp');
fs.mkdirSync(tmp, { recursive: true });

// 1) One continuous timeline with the PayPal checkout window spliced in.
const raw = path.join(DIR, 'raw.mp4');
const norm = 'fps=30,setsar=1,format=yuv420p';
if (meta.popup) {
  const { start: a, end: b } = meta.popup;
  run(['-i', path.join(DIR, 'main.webm'), '-i', path.join(DIR, 'popup.webm'), '-filter_complex',
    `[0:v]trim=0:${a},setpts=PTS-STARTPTS,${norm}[x];[1:v]trim=0:${(b - a).toFixed(2)},setpts=PTS-STARTPTS,scale=-2:680,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x1b2a6b,${norm}[y];[0:v]trim=start=${b},setpts=PTS-STARTPTS,${norm}[z];[x][y][z]concat=n=3:v=1[v]`,
    '-map', '[v]', '-c:v', 'libx264', '-crf', '18', raw]);
} else run(['-i', path.join(DIR, 'main.webm'), '-vf', norm, '-c:v', 'libx264', '-crf', '18', raw]);

// 2) Per scene: drop the waiting periods, then fit to the voice clip.
const scenes = meta.scenes.filter((s) => s.name !== 'end');
const endAt = meta.scenes.find((s) => s.name === 'end')?.at ?? duration(raw);
const audioDir = path.join(DIR, 'audio');
const audioFor = (n) => {
  if (!fs.existsSync(audioDir)) return null;
  const f = fs.readdirSync(audioDir).find((x) => new RegExp(`^0?${n}[^0-9]`).test(x));
  return f ? path.join(audioDir, f) : null;
};
const lines = [];
const parts = [];
scenes.forEach((s, i) => {
  const n = i + 1;
  const from = s.at, to = scenes[i + 1]?.at ?? endAt;
  // keep-ranges = [from,to] minus cuts
  let keep = [[from, to]];
  for (const [a, b] of meta.cuts || []) {
    keep = keep.flatMap(([x, y]) => (b <= x || a >= y) ? [[x, y]] : [[x, a], [b, y]].filter(([p, q]) => q - p > 0.05));
  }
  const silent = path.join(tmp, `v${n}.mp4`);
  const f = keep.map(([x, y], k) => `[0:v]trim=${x.toFixed(2)}:${y.toFixed(2)},setpts=PTS-STARTPTS[k${k}]`).join(';');
  run(['-i', raw, '-filter_complex', `${f};${keep.map((_, k) => `[k${k}]`).join('')}concat=n=${keep.length}:v=1[v]`, '-map', '[v]', '-c:v', 'libx264', '-crf', '18', silent]);
  const S = duration(silent);
  const voice = audioFor(n);
  const L = voice ? duration(voice) : S;
  const out = path.join(tmp, `s${n}.mp4`);
  let vf = 'null';
  let note = '';
  let target = voice ? L + 0.4 : S;
  if (voice && L > S) { vf = `tpad=stop_mode=clone:stop_duration=${(L - S + 0.4).toFixed(2)}`; note = `held last frame +${(L - S).toFixed(1)}s`; }
  else if (voice && S > L + 0.6) {
    // Speed up at most 1.5x and NEVER trim: the payoff of a scene (PAID, Autopilot card) is usually at its end.
    // If the scene is still longer than the voice, the voice simply ends early and the scene plays out silently.
    const speed = Math.min(1.5, S / (L + 0.4));
    vf = `setpts=PTS/${speed.toFixed(3)}`;
    target = Math.max(L + 0.4, S / speed);
    note = `sped up ${speed.toFixed(2)}x${S / speed > L + 0.6 ? `, voice ends ${(S / speed - L).toFixed(1)}s early` : ''}`;
  }
  target = target.toFixed(2);
  const audioIn = voice ? ['-i', voice] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'];
  run(['-i', silent, ...audioIn, '-filter_complex', `[0:v]${vf},trim=0:${target},setpts=PTS-STARTPTS[v];[1:a]aresample=48000,apad,atrim=0:${target},asetpts=PTS-STARTPTS[a]`,
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', out]);
  parts.push(out);
  lines.push(`${String(n).padStart(2, '0')}  ${s.name.replace(/^\d+ /, '').padEnd(30)} video ${S.toFixed(1)}s  ${voice ? `voice ${L.toFixed(1)}s  ${note}` : 'no voice yet'}`);
});

// 3) Join the scenes.
fs.writeFileSync(path.join(tmp, 'list.txt'), parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
const final = path.join(DIR, 'final.mp4');
run(['-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-c', 'copy', '-movflags', '+faststart', final]);
const total = duration(final);
lines.push(`TOTAL ${total.toFixed(1)}s ${total > 180 ? '(OVER 3:00!)' : ''}`);
fs.writeFileSync(path.join(DIR, 'scene-lengths.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
console.log('saved', final);
