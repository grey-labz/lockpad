import { mkdir, copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const project = import.meta.dirname;
const snapshots = JSON.parse(await readFile(join(project, "evidence/snapshots-revised.json"), "utf8"));
if (!snapshots.ok) throw new Error("The current snapshot review did not complete.");
const source = snapshots.outputDir;
const out = join(project, "evidence");
await mkdir(out, { recursive: true });

async function sheet(prefix, output, width) {
  const pages = (await readdir(source)).filter(name => name.startsWith(prefix) && name.endsWith(".jpg")).sort();
  if (!pages.length) throw new Error("Missing review sheets: " + prefix);
  if (pages.length === 1) return copyFile(join(source, pages[0]), join(out, output));
  const filters = pages.map((_, index) => "[" + index + ":v]scale=" + width + ":-2[s" + index + "]");
  filters.push(pages.map((_, index) => "[s" + index + "]").join("") + "vstack=inputs=" + pages.length + "[out]");
  await exec("ffmpeg", ["-v", "error", "-y", ...pages.flatMap(file => ["-i", join(source, file)]), "-filter_complex", filters.join(";"), "-map", "[out]", "-frames:v", "1", "-q:v", "2", join(out, output)]);
}
await sheet("review-beats", "review-beats.jpg", 1800);
await sheet("review-phone", "review-phone.jpg", 1440);
await sheet("review-seam-", "review-seams.jpg", 1800);
const check = await readFile(join(out, "check.json"), "utf8");
if (!JSON.parse(check).ok) throw new Error("The current composition check did not pass.");
await writeFile(join(out, "check.json"), check.replaceAll(project, "."));
console.log("Saved all eleven chapters, ten cut seams and phone-size review sheets.");
