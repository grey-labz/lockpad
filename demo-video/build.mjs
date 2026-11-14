import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const project = import.meta.dirname;
const capture = JSON.parse(await readFile(join(project, "capture-borrow.json"), "utf8"));
const voice = JSON.parse(await readFile(join(project, "voice-borrow.json"), "utf8"));
const scenes = JSON.parse(await readFile(join(project, "narration-borrow.json"), "utf8"));
let previous;
try { previous = JSON.parse(await readFile(join(project, "timing.json"), "utf8")); } catch {}
assert.equal(capture.status, "PASS");
assert.equal(voice.status, "PASS");
assert.equal(capture.clips.length, scenes.length);
assert.equal(voice.segments.length, scenes.length);
assert.equal(scenes.length, 11);
await mkdir(join(project, "compositions"), { recursive: true });
await mkdir(join(project, "assets/vendor"), { recursive: true });
await mkdir(join(project, "assets/video-borrow"), { recursive: true });
// The editable bundle carries its runtime and the original registry component.
await access(join(project, "assets/vendor/gsap.min.js"));
await access(join(project, "assets/vendor/lt-kicker-name-original.html"));

const frame = value => Math.ceil(value * 30) / 30;
for (const scene of scenes) {
  scene.voice = voice.segments.find(segment => segment.id === scene.id);
  scene.footage = capture.clips.find(clip => clip.id === scene.id);
  scene.minimum = frame(Math.max(scene.voice.duration + 0.5, scene.footage.duration / 1.55));
  scene.duration = Math.max(scene.duration, scene.minimum);
}
const targetDuration = frame(Math.max(120, scenes.reduce((sum, scene) => sum + scene.minimum, 0)));
assert.ok(targetDuration <= 180, "The recording needs a tighter take before a delivery edit");
let extra = scenes.reduce((sum, scene) => sum + scene.duration, 0) - targetDuration;
for (const id of ["claim", "purchase", "listing", "seller", "repay", "borrow", "quote", "source", "intro", "activity", "maturity"]) {
  const scene = scenes.find(scene => scene.id === id);
  const available = Math.max(0, scene.duration - scene.minimum);
  const take = Math.min(available, extra);
  scene.duration -= take;
  extra -= take;
}
assert.ok(extra < 0.001, "Narration and footage do not fit the planned edit at natural speed");
let cursor = 0;
const escape = text => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const fonts = `@font-face{font-family:Manrope;src:url('assets/fonts/manrope-regular.ttf') format('truetype');font-weight:400;font-display:block}@font-face{font-family:Manrope;src:url('assets/fonts/manrope-bold.ttf') format('truetype');font-weight:700;font-display:block}`;
const hosts = [], media = [], declarations = [
  { id: "canvasGround", type: "color", label: "Canvas", default: "#020202" },
  { id: "headerInk", type: "color", label: "Chapter text", default: "#edf6ef" },
  { id: "accent", type: "color", label: "Malachite accent", default: "#16db65" },
  { id: "demoDisclosure", type: "string", label: "Demo disclosure", default: "LOCAL NEAR SANDBOX · ZERO-VALUE TUSD" },
];

for (const [index, scene] of scenes.entries()) {
  scene.start = cursor;
  cursor += scene.duration;
  scene.voiceOffset = Math.max(0.2, Math.min(1.2, (scene.duration - scene.voice.duration) * 0.45));
  const encoded = join(project, "assets/video-borrow", scene.id + ".mp4");
  let reuseVideo = previous?.scenes?.find(prior => prior.id === scene.id)?.footage.src === scene.footage.src;
  try { await access(encoded); } catch { reuseVideo = false; }
  if (!reuseVideo) await exec("ffmpeg", ["-v", "error", "-y", "-i", join(project, scene.footage.src), "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", encoded]);
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", encoded]);
  scene.videoDuration = Number(JSON.parse(stdout).format.duration);
  scene.playbackRate = (scene.videoDuration - 1 / 30) / scene.duration;
  assert.ok(scene.playbackRate < 1.6, "Recorded workflow would be compressed too much");
  scene.video = "assets/video-borrow/" + scene.id + ".mp4";
  const title = scene.title;
  const note = scene.id === "maturity" ? "Original maturity unchanged · local time advanced"
    : scene.id === "claim" ? "1,000 payout + 80 remaining = 1,080 TUSD in wallet"
      : scene.id === "listing" ? "8% discount · principal stays in its source vault"
        : scene.id === "purchase" ? "Payout right delivered before seller proceeds release"
          : scene.id === "seller" ? "Actual token payment after NFT delivery"
            : scene.id === "activity" ? "Confirmed local transactions · reference-vault prototype"
              : scene.id === "source" ? "Existing position · principal and maturity checked at source"
                : "Borrow against a supported position, or list its payout right";
  declarations.push({ id: scene.id + "Title", type: "string", label: "Chapter " + (index + 1), default: title });
  declarations.push({ id: scene.id + "Footage", type: "string", label: "Footage " + (index + 1), default: scene.video });

  const composition = `<template>
  <style>
    ${fonts}
    #root{position:absolute;inset:0;font-family:Manrope;color:var(--headerInk,#edf6ef)}
    .scene-ground{position:absolute;inset:0;background:var(--canvasGround,#020202)}
    .chapter{position:absolute;left:192px;top:108px;width:1536px;height:130px}
    .chapter-copy{position:absolute;left:0;top:0;width:1536px}
    .chapter h1{font-size:64px;line-height:1.08;font-weight:700;letter-spacing:-.035em;white-space:nowrap;margin:0}
    .chapter-baseline{position:absolute;left:0;bottom:-7px;width:120px;height:2px;background:var(--accent,#16db65);transform-origin:0 50%}
    .disclosure{position:absolute;left:0;top:74px;text-align:left;width:1536px;font-size:54px;line-height:1.08;font-weight:700;letter-spacing:0;white-space:nowrap;color:#a0b6a6}
    .app-screen{position:absolute;left:272px;top:252px;width:1376px;height:774px;object-fit:contain;border:1px solid #04471c}
    .proof-note{position:absolute;left:304px;top:924px;padding:15px 22px;max-width:1312px;border:1px solid #058c42;background:#0d2818;color:#edf6ef;font-size:54px;line-height:1.15;font-weight:700;white-space:nowrap}
  </style>
  <div id="root" data-composition-id="${scene.id}" data-width="1920" data-height="1080">
    <div class="scene-ground"></div>
    <div id="${scene.id}-chapter" class="clip" data-start="0" data-duration="${scene.duration}" data-track-index="2" data-hold="Narration-led chapter text">
      <div class="chapter">
        <div class="chapter-copy"><h1 id="${scene.id}-title" data-var-text="${scene.id}Title">${escape(title)}</h1><div id="${scene.id}-baseline" class="chapter-baseline"></div></div>
        <div class="disclosure" data-var-text="demoDisclosure">LOCAL NEAR SANDBOX · ZERO-VALUE TUSD</div>
      </div>
    </div>
    <video id="${scene.id}-footage" class="clip app-screen" data-start="0" data-duration="${scene.duration}" data-track-index="1" data-media-start="0" data-playback-rate="${scene.playbackRate}" src="${scene.video}" data-var-src="${scene.id}Footage" muted playsinline preload="auto"></video>
    ${["maturity", "claim"].includes(scene.id) ? `<div id="${scene.id}-note" class="clip" data-start="${scene.id === "claim" ? scene.duration - 3.5 : 0}" data-duration="${scene.id === "claim" ? 3.5 : scene.duration}" data-track-index="4" data-layout-allow-overlap><div class="proof-note">${scene.id === "claim" ? "Payout 1,000 TUSD · Wallet 80 → 1,080 TUSD" : "Time advanced · original maturity unchanged"}</div></div>` : ""}
  </div>
  <script>
    const tl=gsap.timeline({paused:true});
    // Adapted from the registry lt-kicker-name drawn baseline; the readable title holds.
    tl.fromTo('#${scene.id}-baseline',{scaleX:0},{scaleX:1,duration:0.35,ease:'power4.out'},0);
    window.__timelines['${scene.id}']=tl;
  </script>
</template>
`;
  await writeFile(join(project, "compositions", scene.id + ".html"), composition);
  hosts.push(`<div id="${scene.id}" class="clip" data-composition-id="${scene.id}" data-composition-src="compositions/${scene.id}.html" data-start="${scene.start}" data-duration="${scene.duration}" data-width="1920" data-height="1080" data-track-index="1" data-track-kind="graphics" data-beat="${scene.id}"></div>`);
  media.push(`<audio id="voice-${scene.id}" class="clip" data-start="${scene.start + scene.voiceOffset}" data-duration="${scene.voice.duration}" data-track-index="3" data-volume="1" data-fade-in="0.04" data-fade-out="0.08" src="${scene.voice.src}"></audio>`);
}
assert.ok(Math.abs(cursor - targetDuration) < 0.001);
const root = `<!doctype html>
<html lang="en" data-composition-variables='${JSON.stringify(declarations)}'>
<head><meta charset="UTF-8"><meta name="viewport" content="width=1920,height=1080"><title>Lockpad · Working demo</title><script src="assets/vendor/gsap.min.js"></script>
<style>${fonts}*{box-sizing:border-box;margin:0;padding:0}html,body{width:1920px;height:1080px;overflow:hidden;background:#020202}#root{position:relative;width:100%;height:100%}.clip{position:absolute;inset:0}</style></head>
<body><div id="root" data-composition-id="main" data-start="0" data-duration="${targetDuration}" data-width="1920" data-height="1080" data-fps="30">
${hosts.join("\n")}
${media.join("\n")}
</div><script>window.__timelines=window.__timelines||{};window.__timelines.main=gsap.timeline({paused:true});</script></body></html>
`;
await writeFile(join(project, "index.html"), root);
await writeFile(join(project, "timing.json"), JSON.stringify({ width: 1920, height: 1080, fps: 30, duration: targetDuration, voice: voice.voice, scenes }, null, 2) + "\n");
await writeFile(join(project, "narration.txt"), scenes.map(scene => scene.text).join("\n\n") + "\n");
console.log(`EDIT READY: ${targetDuration} seconds, 11 recorded borrow-or-sell chapters, Jack John narration; maximum video rate`, Math.max(...scenes.map(scene => scene.playbackRate)).toFixed(2));
