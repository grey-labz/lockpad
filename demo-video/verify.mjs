import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const project = import.meta.dirname;
const file = join(project, "renders/lockpad-demo.mp4");
const evidence = join(project, "evidence");
const cli = process.argv[2] || "hyperframes";
await mkdir(evidence, { recursive: true });
const run = (program, args) => exec(program, args, { cwd: project, maxBuffer: 20 * 1024 * 1024 });
const check = JSON.parse(await readFile(join(evidence, "check.json"), "utf8"));
const capture = JSON.parse(await readFile(join(project, "capture-borrow.json"), "utf8"));
const voice = JSON.parse(await readFile(join(project, "voice-borrow.json"), "utf8"));
const timing = JSON.parse(await readFile(join(project, "timing.json"), "utf8"));
assert.equal(check.ok, true);
assert.equal(check.browserSkipped, false);
assert.equal(capture.status, "PASS");
assert.equal(voice.status, "PASS");
assert.ok((await stat(file)).size > 100000);

const { stdout: probe } = await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]);
const media = JSON.parse(probe);
const video = media.streams.find(stream => stream.codec_type === "video");
const sound = media.streams.find(stream => stream.codec_type === "audio");
assert.equal(video.width, 1920);
assert.equal(video.height, 1080);
assert.equal(video.r_frame_rate, "30/1");
assert.equal(video.codec_name, "h264");
assert.equal(video.pix_fmt, "yuv420p");
assert.equal(Number(video.nb_frames), Math.round(timing.duration * 30));
assert.ok(Math.abs(Number(media.format.duration) - timing.duration) < 0.1);
assert.equal(sound.codec_name, "aac");
await run("ffmpeg", ["-v", "error", "-i", file, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"]);

const { stdout: audioReport } = await run(cli, ["audio", file, "--only", "loudness,silence,moments", "--quality", "local", "--json"]);
const { stderr: loudnessReport } = await run("ffmpeg", ["-hide_banner", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]);
const summary = loudnessReport.slice(loudnessReport.lastIndexOf("Summary:"));
const audio = {
  integratedLufs: Number(/I:\s*([-\d.]+)\s*LUFS/.exec(summary)?.[1]),
  loudnessRangeLu: Number(/LRA:\s*([-\d.]+)\s*LU/.exec(summary)?.[1]),
  truePeakDbfs: Number(/Peak:\s*([-\d.]+)\s*dBFS/.exec(summary)?.[1]),
  listeningReviewed: false,
};
await writeFile(join(evidence, "audio.json"), audioReport.trim() ? audioReport.replaceAll(project, ".") : JSON.stringify({ provider: "FFmpeg EBU R128", file: "renders/lockpad-demo.mp4", audio }, null, 2) + "\n");
assert.ok(Number.isFinite(audio.integratedLufs) && audio.integratedLufs > -30, "Narration is absent or too quiet");
assert.ok(Number.isFinite(audio.truePeakDbfs) && audio.truePeakDbfs <= 0.2, "Audio clips above full scale");

const shots = timing.scenes.map(scene => ({ time: scene.start + scene.duration / 2, label: scene.title }));
for (const [index, shot] of shots.entries()) {
  shot.file = `evidence/decoded-frame-${index + 1}.png`;
  await run("ffmpeg", ["-v", "error", "-y", "-ss", String(shot.time), "-i", file, "-frames:v", "1", join(project, shot.file)]);
}
const filters = shots.map((shot, index) => `[${index}:v]scale=480:270,pad=480:306:0:36:color=0x020202,drawtext=fontfile=assets/fonts/manrope-bold.ttf:text='${shot.time.toFixed(2)}s - ${shot.label}':x=12:y=7:fontsize=16:fontcolor=0xedf6ef[v${index}]`);
filters.push(shots.map((_, index) => `[v${index}]`).join("") + `xstack=inputs=${shots.length}:layout=${shots.map((_,index)=>`${(index%2)*480}_${Math.floor(index/2)*306}`).join('|')}:fill=0x020202[out]`);
await run("ffmpeg", ["-v", "error", "-y", ...shots.flatMap(shot => ["-i", join(project, shot.file)]), "-filter_complex", filters.join(";"), "-map", "[out]", "-frames:v", "1", "-q:v", "2", join(evidence, "decoded-frames.jpg")]);

const compositionSources = {};
for (const source of ["index.html", "timing.json", ...((await readdir(join(project, "compositions"))).filter(name => name.endsWith(".html")).map(name => "compositions/" + name))]) {
  compositionSources[source] = createHash("sha256").update(await readFile(join(project, source))).digest("hex");
}
const delivery = {
  status: "PASS",
  file: "renders/lockpad-demo.mp4",
  sha256: createHash("sha256").update(await readFile(file)).digest("hex"),
  bytes: (await stat(file)).size,
  durationSeconds: Number(media.format.duration),
  width: video.width,
  height: video.height,
  fps: 30,
  frameCount: Number(video.nb_frames),
  codecs: { video: video.codec_name, audio: sound.codec_name, pixelFormat: video.pix_fmt },
  fullDecode: "PASS - all video and audio streams",
  sampledFrames: shots,
  audio,
  narration: { provider: voice.provider, voice: voice.voice },
  compositionCheck: { ok: check.ok, browserSkipped: check.browserSkipped },
  compositionSources,
  capture: { status: capture.status, recordedAt: capture.recordedAt, network: capture.network, token: capture.testToken, actors: capture.actors },
};
await writeFile(join(evidence, "delivery.json"), JSON.stringify(delivery, null, 2) + "\n");
console.log(`DELIVERY PASS: ${delivery.durationSeconds}s, ${delivery.width}x${delivery.height}, ${delivery.frameCount} frames; audio ${audio.integratedLufs} LUFS, peak ${audio.truePeakDbfs} dBFS`);
