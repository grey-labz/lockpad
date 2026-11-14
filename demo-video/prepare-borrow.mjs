import { readFile, writeFile, mkdir, copyFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const project = import.meta.dirname;
const voiceDir = join(project, "assets/voice-borrow");
await mkdir(voiceDir, { recursive: true });
await mkdir(join(project, "assets/fonts"), { recursive: true });
for (const font of ["manrope-regular.ttf", "manrope-bold.ttf", "OFL.txt"]) {
  await copyFile(resolve(project, "../public/fonts", font), join(project, "assets/fonts", font));
}
const scenes = JSON.parse(await readFile(join(project, "narration-borrow.json"), "utf8"));
const text = scenes.map(scene => scene.text).join("\n\n");
const hash = createHash("sha256").update(text).digest("hex");
const metadataFile = join(project, "voice-borrow.json");
let metadata;
try { metadata = JSON.parse(await readFile(metadataFile, "utf8")); } catch {}

async function probe(file) {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", file]);
  return Number(JSON.parse(stdout).format.duration);
}
if (metadata?.status === "PASS" && metadata.textSha256 === hash) {
  await access(join(project, metadata.src));
  console.log("Reusing the completed ElevenLabs narration; no additional generation.");
} else {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("Existing ElevenLabs key was not found. Set ELEVENLABS_API_KEY; do not add it to this project.");
  const headers = { "xi-api-key": key, "Content-Type": "application/json" };
  const get = async path => {
    const response = await fetch("https://api.elevenlabs.io" + path, { headers, signal: AbortSignal.timeout(25000) });
    const data = await response.json();
    if (!response.ok) throw new Error("ElevenLabs access check failed (" + response.status + "): " + JSON.stringify(data.detail));
    return data;
  };
  // Resolve network and quota before requesting any generation.
  let subscription;
  try { subscription = await get("/v1/user/subscription"); }
  catch (error) {
    if (!error.message.includes("missing_permissions")) throw error;
    console.log("The speech key does not permit account reads; narration uses its text-to-speech permission.");
  }
  if (subscription && subscription.character_limit - subscription.character_count < text.length) {
    throw new Error("ElevenLabs has insufficient remaining narration allowance. No voice was generated.");
  }
  // This is the existing Jack John voice used in the user's previous demo projects.
  const voice = { name: "Jack John - Conversational and Upbeat", voice_id: "7EzWGsX10sAS4c9m9cPf" };
  console.log("Narrator:", voice.name);
  const jobFile = join(project, "voice-borrow-request.json");
  let prior;
  try { prior = JSON.parse(await readFile(jobFile, "utf8")); } catch {}
  if (prior?.textSha256 === hash && ["REQUESTED", "RESPONSE UNKNOWN"].includes(prior.status)) {
    throw new Error("A previous narration request has an unresolved response. Check its history before generating another take.");
  }
  const job = { provider: "ElevenLabs", voice: voice.name, voiceId: voice.voice_id, model: "eleven_multilingual_v2", textSha256: hash, status: "REQUESTED", requestedAt: new Date().toISOString() };
  await writeFile(jobFile, JSON.stringify(job, null, 2) + "\n");
  let response;
  try {
    response = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(voice.voice_id) + "/with-timestamps?output_format=mp3_44100_128", {
      method: "POST", headers, signal: AbortSignal.timeout(120000),
      body: JSON.stringify({ text, model_id: job.model,
        voice_settings: { stability: 0.48, similarity_boost: 0.76, style: 0.16, use_speaker_boost: true, speed: 1.0 } }),
    });
  } catch (error) {
    job.status = "RESPONSE UNKNOWN";
    await writeFile(jobFile, JSON.stringify(job, null, 2) + "\n");
    throw error;
  }
  const result = await response.json();
  if (!response.ok) {
    job.status = "REFUSED";
    await writeFile(jobFile, JSON.stringify(job, null, 2) + "\n");
    throw new Error("ElevenLabs narration failed (" + response.status + "): " + JSON.stringify(result.detail));
  }
  if (!result.audio_base64 || !result.alignment) throw new Error("ElevenLabs response omitted audio or native alignment.");
  await writeFile(join(voiceDir, "original.mp3"), Buffer.from(result.audio_base64, "base64"));
  await writeFile(join(voiceDir, "alignment.json"), JSON.stringify({ alignment: result.alignment, normalized_alignment: result.normalized_alignment }, null, 2) + "\n");
  await exec("ffmpeg", ["-v", "error", "-y", "-i", join(voiceDir, "original.mp3"), "-af", "loudnorm=I=-16:TP=-1:LRA=11", "-ar", "48000", "-ac", "1", join(voiceDir, "narration.wav")]);
  job.status = "COMPLETED";
  await writeFile(jobFile, JSON.stringify(job, null, 2) + "\n");
  metadata = { ...job, status: "GENERATED", src: "assets/voice-borrow/narration.wav", duration: await probe(join(voiceDir, "narration.wav")) };
  await writeFile(metadataFile, JSON.stringify(metadata, null, 2) + "\n");
}

const alignmentData = JSON.parse(await readFile(join(voiceDir, "alignment.json"), "utf8"));
const alignment = alignmentData.normalized_alignment || alignmentData.alignment;
// Pace the existing take at approximately 155 words/minute without changing pitch.
const narrationTempo = 1.0;
await exec("ffmpeg", ["-v", "error", "-y", "-i", join(voiceDir, "original.mp3"), "-af", `atempo=${narrationTempo},loudnorm=I=-16:TP=-1:LRA=11`, "-ar", "48000", "-ac", "1", join(voiceDir, "narration.wav")]);
metadata.duration = await probe(join(voiceDir, "narration.wav"));
metadata.narrationTempo = narrationTempo;
const words = [];
let word = "", start = 0, end = 0;
const flush = () => { if (word) words.push({ id: "w" + words.length, text: word, start, end }); word = ""; };
for (let index = 0; index < alignment.characters.length; index++) {
  const character = alignment.characters[index];
  if (/^\s+$/.test(character)) flush();
  else {
    if (!word) start = alignment.character_start_times_seconds[index] / narrationTempo;
    word += character;
    end = alignment.character_end_times_seconds[index] / narrationTempo;
  }
}
flush();
const normalize = word => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const actual = words.filter(word => normalize(word.text));
const expected = text.split(/\s+/).map(normalize).filter(Boolean);
if (JSON.stringify(actual.map(word => normalize(word.text))) !== JSON.stringify(expected)) {
  await writeFile(join(voiceDir, "narration.words.json"), JSON.stringify(words, null, 2) + "\n");
  throw new Error("Native alignment differs from the narration script; inspect the word file before timing the edit.");
}
metadata.segments = [];
let offset = 0;
for (const scene of scenes) {
  const count = scene.text.split(/\s+/).map(normalize).filter(Boolean).length;
  const first = actual[offset], last = actual[offset + count - 1];
  const next = actual[offset + count];
  const trimStart = Math.max(0, first.start - 0.12);
  const trimEnd = Math.min(metadata.duration, last.end + 0.22, next ? next.start - 0.03 : Infinity);
  const file = join(voiceDir, scene.id + ".wav");
  await exec("ffmpeg", ["-v", "error", "-y", "-ss", String(trimStart), "-t", String(trimEnd - trimStart), "-i", join(voiceDir, "narration.wav"), "-ar", "48000", "-ac", "1", file]);
  metadata.segments.push({ id: scene.id, src: "assets/voice-borrow/" + scene.id + ".wav", duration: await probe(file), trimStart, trimEnd,
    words: actual.slice(offset, offset + count).map(word => ({ ...word, start: word.start - trimStart, end: word.end - trimStart })) });
  offset += count;
}
metadata.status = "PASS";
metadata.alignment = "ElevenLabs native character timestamps scaled by the documented tempo change and grouped into exact script words";
await writeFile(metadataFile, JSON.stringify(metadata, null, 2) + "\n");
await writeFile(join(voiceDir, "narration.words.json"), JSON.stringify(words, null, 2) + "\n");
console.log("NARRATION READY:", metadata.voice, metadata.duration.toFixed(2) + "s;", metadata.segments.length, "word-aligned chapters");
