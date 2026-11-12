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

// 0) Clock correction. Scene markers are wall-clock seconds, but Playwright's screencast drifts
// (≈2–3% slower) and starts a little before the clock. Map wall time → video time with a line
// through two anchors: the main page going black when PayPal's checkout pop-up opens, and the end.
{
  const mainDur = duration(path.join(DIR, 'main.webm'));
  const endWall = meta.scenes.find((s) => s.name === 'end')?.at;
  let A = 0, B = 1;
  if (endWall && mainDur) {
    B = mainDur / endWall;
    if (meta.popup) {
      // ffmpeg writes filter logs to stderr, so read stderr whether or not it exits cleanly.
      const out = String(require('child_process').spawnSync(FF, ['-i', path.join(DIR, 'main.webm'), '-vf', 'blackdetect=d=0.5:pix_th=0.98:pic_th=0.98', '-an', '-f', 'null', '-'], { encoding: 'utf8' }).stderr || '');
      const blacks = [...out.matchAll(/black_start:([\d.]+)/g)].map((m) => +m[1]);
      const anchor = blacks.find((v) => Math.abs(v - meta.popup.start) < 20);
      if (anchor != null) { B = (mainDur - anchor) / (endWall - meta.popup.start); A = anchor - B * meta.popup.start; }
    }
    const map = (t) => A + B * t;
    meta.scenes.forEach((s) => { s.at = map(s.at); });
    meta.cuts = (meta.cuts || []).map(([x, y]) => [map(x), map(y)]);
    if (meta.popup) meta.popup = { start: map(meta.popup.start), end: map(meta.popup.end) };
    console.log(`clock correction: video = ${A.toFixed(2)}s + ${B.toFixed(4)} × wall`);
  }
}

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
// Clean up a voice clip recorded on a laptop or phone: trim silence at both ends, cut low rumble,
// reduce steady background noise, and level the loudness to YouTube's standard (-16 LUFS).
const CLEAN = [
  'highpass=f=70',
  'afftdn=nf=-25',
  'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12',
  'areverse', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.25', 'areverse',
  'loudnorm=I=-16:TP=-1.5:LRA=11',
  'aresample=48000',
].join(',');
const audioFor = (n) => {
  if (!fs.existsSync(audioDir)) return null;
  const f = fs.readdirSync(audioDir).find((x) => new RegExp(`^0?${n}[^0-9]`).test(x));
  if (!f) return null;
  const clean = path.join(tmp, `voice${n}.wav`);
  run(['-i', path.join(audioDir, f), '-af', CLEAN, '-ac', '1', clean]);
  return clean;
};
const cuesFile = path.join(DIR, 'cues.json');
const cues = fs.existsSync(cuesFile) ? JSON.parse(fs.readFileSync(cuesFile, 'utf8')) : {};
// Split a (cleaned) voice clip into `k` sentences. With `fractions` (expected sentence boundaries as
// a share of the clip, from the script's text lengths) pick the pause nearest each boundary, favouring
// longer pauses; otherwise use the k-1 longest pauses.
function splitVoice(file, k, L, fractions) {
  if (k <= 1) return [[0, L]];
  const log = String(require('child_process').spawnSync(FF, ['-i', file, '-af', 'silencedetect=noise=-38dB:d=0.18', '-f', 'null', '-'], { encoding: 'utf8' }).stderr || '');
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
  const gaps = starts.map((s, i) => ({ s, e: ends[i] ?? L })).filter((g) => g.s > 0.4 && g.e < L - 0.4);
  let cut;
  if (fractions && fractions.length === k - 1) {
    cut = fractions.map((f) => {
      const want = f * L;
      const best = gaps.reduce((b, g) => { const sc = Math.abs((g.s + g.e) / 2 - want) - 2 * (g.e - g.s); return !b || sc < b.sc ? { g, sc } : b; }, null);
      return best ? (best.g.s + best.g.e) / 2 : want;
    });
  } else cut = gaps.sort((x, y) => (y.e - y.s) - (x.e - x.s)).slice(0, k - 1).sort((x, y) => x.s - y.s).map((g) => (g.s + g.e) / 2);
  const pts = [0, ...cut, L];
  return pts.slice(0, -1).map((p, i) => [p, pts[i + 1]]);
}
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
  // Sentence cues (video/cues.json): for long scenes, cut the clip at its natural pauses and start
  // each sentence when its moment appears on screen (times are in this scene's footage, before speed-up).
  let audioGraph = `[1:a]aresample=48000,apad,atrim=0:${target.toFixed ? target.toFixed(2) : target},asetpts=PTS-STARTPTS[a]`;
  const cueDef = voice && cues[String(n)];
  const cue = cueDef && (Array.isArray(cueDef) ? cueDef : cueDef.at);
  if (cue && cue.length) {
    const speed = S > L + 0.6 ? Math.min(1.5, S / (L + 0.4)) : 1;
    const segs = splitVoice(voice, cue.length, L, cueDef.split);
    let prevEnd = -0.25;
    const placed = segs.map(([a, b], k) => { const at = Math.max(cue[k] / speed, prevEnd + 0.25); prevEnd = at + (b - a); return { a, b, at }; });
    target = Math.max(S / speed, prevEnd + 0.4);
    vf = `setpts=PTS/${speed.toFixed(3)}` + (target > S / speed + 0.05 ? `,tpad=stop_mode=clone:stop_duration=${(target - S / speed + 0.2).toFixed(2)}` : '');
    note = `sped up ${speed.toFixed(2)}x, ${segs.length} sentence(s) at ${placed.map((p) => p.at.toFixed(1) + 's').join(', ')}`;
    // Note: pad to an exact length (apad=whole_dur); an open-ended apad after amix never terminates.
    audioGraph = `[1:a]asplit=${placed.length}${placed.map((_, k) => `[in${k}]`).join('')};` + placed.map((p, k) => `[in${k}]atrim=${p.a.toFixed(2)}:${p.b.toFixed(2)},asetpts=PTS-STARTPTS,adelay=${Math.round(p.at * 1000)}:all=1[p${k}]`).join(';')
      + `;${placed.map((_, k) => `[p${k}]`).join('')}amix=inputs=${placed.length}:normalize=0:duration=longest,aresample=48000,apad=whole_dur=${target.toFixed(2)},atrim=0:${target.toFixed(2)}[a]`;
  }
  target = Number(target).toFixed(2);
  const audioIn = voice ? ['-i', voice] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'];
  if (!cue) audioGraph = `[1:a]aresample=48000,apad,atrim=0:${target},asetpts=PTS-STARTPTS[a]`;
  run(['-i', silent, ...audioIn, '-filter_complex', `[0:v]${vf},trim=0:${target},setpts=PTS-STARTPTS[v];${audioGraph}`,
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
