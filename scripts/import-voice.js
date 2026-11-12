// Copies your recorded voice clips (01.webm … 14.webm from scripts/voice-recorder.html) from Downloads
// into video/audio/, replacing any placeholder clip with the same number, then you run video:build.
//   node scripts/import-voice.js [folder]   (default: your Downloads folder)
const fs = require('fs');
const os = require('os');
const path = require('path');

const src = process.argv[2] || path.join(os.homedir(), 'Downloads');
const dst = path.join(__dirname, '..', 'video', 'audio');
fs.mkdirSync(dst, { recursive: true });
const AUDIO = /\.(webm|m4a|ogg|mp3|wav|aac)$/i;

// Browsers rename repeats as "01 (1).webm": take the newest file for each number.
const newest = {};
for (const f of fs.readdirSync(src)) {
  const m = f.match(/^(\d{2})(?: \(\d+\))?\.(webm|m4a|ogg|mp3|wav|aac)$/i);
  if (!m) continue;
  const n = Number(m[1]);
  if (n < 1 || n > 30) continue;
  const full = path.join(src, f);
  const t = fs.statSync(full).mtimeMs;
  if (!newest[n] || t > newest[n].t) newest[n] = { full, t, ext: path.extname(f).toLowerCase() };
}
const nums = Object.keys(newest).map(Number).sort((a, b) => a - b);
if (!nums.length) { console.error(`No clips named 01.webm, 02.webm … found in ${src}`); process.exit(1); }
for (const n of nums) {
  const id = String(n).padStart(2, '0');
  for (const old of fs.readdirSync(dst)) if (old.startsWith(id + '.') && AUDIO.test(old)) fs.unlinkSync(path.join(dst, old));
  fs.copyFileSync(newest[n].full, path.join(dst, id + newest[n].ext));
}
console.log(`Imported ${nums.length} clip(s): ${nums.map((n) => String(n).padStart(2, '0')).join(' ')}`);
const expected = 14;
const missing = Array.from({ length: expected }, (_, i) => i + 1).filter((n) => !newest[n]);
if (missing.length) console.log(`Not found (placeholder voice kept): ${missing.map((n) => String(n).padStart(2, '0')).join(' ')}`);
