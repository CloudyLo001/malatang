// Cuts the 80-second trailer from the Blender renders and gameplay captures.
// Usage (from the project root): node video/edit.mjs wide|tall
// Output: video/out/malatang-trailer-16x9.mp4 or video/out/malatang-trailer-9x16.mp4
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const aspect = process.argv[2] ?? 'wide';
const wide = aspect === 'wide';
const W = wide ? 1920 : 1080;
const H = wide ? 1080 : 1920;
const FRAMES = path.join('video', 'frames');
const TMP = path.join('video', 'out', `segments-${aspect}`);
const FINAL = path.join('video', 'out', `malatang-trailer-${wide ? '16x9' : '9x16'}.mp4`);
fs.mkdirSync(TMP, { recursive: true });

const FONT = 'C\\:/Windows/Fonts/segoeuib.ttf';
const FONT_BLACK = 'C\\:/Windows/Fonts/seguibl.ttf';
const FONT_LIGHT = 'C\\:/Windows/Fonts/segoeuisl.ttf';

// [source, seconds, caption]
const SHOTS = [
  ['blender:fall', 6, null],
  ['game:wall', 6, '28 ingredients on the wall'],
  ['blender:lineup', 6, 'Every piece modeled in 3D'],
  ['game:spree', 8, 'Grab whatever you want'],
  ['game:close', 6, null],
  ['blender:drop', 6, 'It all goes in the bowl'],
  ['game:inspect', 6, "Check what's inside"],
  ['game:guess', 6, 'Guess the bill'],
  ['game:weigh', 7, 'Then weigh it'],
  ['game:cook', 7, 'Cooked in the soup you chose'],
  ['blender:cooked', 6, null],
  ['game:pixel', 10, 'Also in pixel art'],
];

const total = SHOTS.reduce((sum, s) => sum + s[1], 0);
if (total !== 80) throw new Error(`timeline is ${total}s, expected 80s`);

function run(args) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

function textFile(name, text) {
  const file = path.join(TMP, `${name}.txt`);
  fs.writeFileSync(file, text);
  return file.replace(/\\/g, '/').replace(':', '\\:');
}

/** Fade a drawtext in and out over its window. */
const alpha = (start, end, fade = 0.35) =>
  `'if(lt(t,${start}),0,if(lt(t,${start + fade}),(t-${start})/${fade},if(lt(t,${end - fade}),1,if(lt(t,${end}),(${end}-t)/${fade},0))))'`;

function caption(name, text, seconds) {
  const size = Math.round((wide ? 0.05 : 0.034) * (wide ? H : H));
  const y = wide ? 'h*0.1' : 'h*0.075';
  return `drawtext=fontfile='${FONT}':textfile='${textFile(name, text)}':fontsize=${size}:fontcolor=white:` +
    `borderw=0:shadowcolor=black@0.6:shadowx=0:shadowy=3:box=1:boxcolor=0x1a100b@0.62:boxborderw=${Math.round(size * 0.55)}:` +
    `x=(w-text_w)/2:y=${y}:alpha=${alpha(0.35, seconds - 0.25)}`;
}

function titleCard(name, seconds, start = 0.6) {
  const big = Math.round(wide ? H * 0.15 : W * 0.17);
  const small = Math.round(big * 0.34);
  return [
    `drawtext=fontfile='${FONT_BLACK}':textfile='${textFile(`${name}-a`, 'MALATANG')}':fontsize=${big}:fontcolor=0xF3C35A:` +
      `shadowcolor=black@0.7:shadowx=0:shadowy=5:x=(w-text_w)/2:y=(h-text_h)/2-${Math.round(big * 0.35)}:alpha=${alpha(start, seconds + 1)}`,
    `drawtext=fontfile='${FONT_LIGHT}':textfile='${textFile(`${name}-b`, 'GUESS  THE  BILL')}':fontsize=${small}:fontcolor=white:` +
      `shadowcolor=black@0.7:shadowx=0:shadowy=3:x=(w-text_w)/2:y=(h)/2+${Math.round(big * 0.42)}:alpha=${alpha(start + 0.5, seconds + 1)}`,
  ];
}

function endCard(name, seconds, from) {
  const big = Math.round(wide ? H * 0.13 : W * 0.15);
  const small = Math.round(big * 0.3);
  const dim = `drawbox=x=0:y=0:w=iw:h=ih:color=0x140d09@0.72:t=fill:enable='gte(t,${from})'`;
  return [
    dim,
    `drawtext=fontfile='${FONT_BLACK}':textfile='${textFile(`${name}-a`, 'MALATANG')}':fontsize=${big}:fontcolor=0xF3C35A:` +
      `x=(w-text_w)/2:y=(h-text_h)/2-${Math.round(big * 0.45)}:alpha=${alpha(from + 0.15, seconds + 1)}`,
    `drawtext=fontfile='${FONT_LIGHT}':textfile='${textFile(`${name}-b`, 'GUESS  THE  BILL')}':fontsize=${small}:fontcolor=white:` +
      `x=(w-text_w)/2:y=h/2+${Math.round(big * 0.25)}:alpha=${alpha(from + 0.4, seconds + 1)}`,
    `drawtext=fontfile='${FONT}':textfile='${textFile(`${name}-c`, 'Three.js game  ·  3D models made with Mint')}':fontsize=${Math.round(small * 0.62)}:fontcolor=white@0.75:` +
      `x=(w-text_w)/2:y=h/2+${Math.round(big * 0.25 + small * 1.7)}:alpha=${alpha(from + 0.7, seconds + 1)}`,
  ];
}

const segments = [];
SHOTS.forEach(([source, seconds, text], index) => {
  const [kind, name] = source.split(':');
  const frames = seconds * 30;
  const dir = kind === 'blender' ? path.join(FRAMES, name) : path.join(FRAMES, `game-${aspect}`, name);
  const pattern = kind === 'blender' ? path.join(dir, '%04d.png') : path.join(dir, '%04d.jpg');
  const startNumber = kind === 'blender' ? 1 : 0;
  if (!fs.existsSync(dir)) throw new Error(`missing frames: ${dir}`);

  const filters = [];
  if (kind === 'blender') {
    filters.push(wide ? 'crop=1920:1080:0:(ih-1080)/2' : 'crop=1080:1920:(iw-1080)/2:0');
  } else {
    filters.push(`scale=${W}:${H}`);
  }
  if (name === 'fall') filters.push(...titleCard(name, seconds));
  if (text) filters.push(caption(`cap${index}`, text, name === 'pixel' ? 6.6 : seconds));
  if (name === 'pixel') filters.push(...endCard(name, seconds, 6.8));
  if (index === 0) filters.push('fade=t=in:st=0:d=0.6');
  if (index === SHOTS.length - 1) filters.push(`fade=t=out:st=${seconds - 0.5}:d=0.5`);
  filters.push('format=yuv420p');

  const out = path.join(TMP, `${String(index).padStart(2, '0')}-${name}.mp4`);
  run([
    '-framerate', '30', '-start_number', String(startNumber), '-i', pattern,
    '-frames:v', String(frames), '-vf', filters.join(','),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-r', '30', out,
  ]);
  segments.push(out);
  console.log(`${aspect}: ${name} ${seconds}s`);
});

const list = path.join(TMP, 'list.txt');
fs.writeFileSync(list, segments.map((s) => `file '${path.resolve(s).replace(/\\/g, '/')}'`).join('\n'));
run([
  '-f', 'concat', '-safe', '0', '-i', list,
  '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
  '-map', '0:v', '-map', '1:a', '-shortest',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30',
  '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', FINAL,
]);
console.log('wrote', FINAL);
