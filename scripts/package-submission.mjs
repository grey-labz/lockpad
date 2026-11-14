import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const run = promisify(execFile);
const project = resolve(import.meta.dirname, "..");
const newline = String.fromCharCode(10);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async file => JSON.parse(await readFile(join(project, file), "utf8"));
let publicSignatures = 0;
function credentialScanText(file, bytes) {
  const content = bytes.toString("utf8");
  if (!file.endsWith(".json")) return content;
  function visit(value, path = []) {
    // NEAR RPC signatures are public receipt data. Their 64-byte encoding
    // resembles a private key; allow only the documented transaction field.
    if (typeof value === "string" && path.at(-1) === "signature" && path.at(-2) === "transaction" && /^ed25519:[1-9A-HJ-NP-Za-km-z]{75,100}$/.test(value)) {
      publicSignatures += 1;
      return "[public NEAR transaction signature]";
    }
    if (Array.isArray(value)) return value.map((entry, index) => visit(entry, [...path, String(index)]));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, visit(entry, [...path, key])]));
    return value;
  }
  return JSON.stringify(visit(JSON.parse(content)));
}
const reports = {};
for (const name of ["unit-tests", "browser-tests", "lending-tests", "release-tests"]) {
  const report = reports[name] = await json("docs/evidence/" + name + ".json");
  assert.equal(report.status, "PASS", name + " must pass before packaging");
  for (const [file, expected] of Object.entries(report.sources || {})) {
    assert.equal(hash(await readFile(join(project, file))), expected, file + " changed after " + name);
  }
}
assert.ok(Object.keys(reports["unit-tests"].sources).length > 0);
assert.ok(Object.keys(reports["browser-tests"].sources).length > 0);
assert.equal(reports["browser-tests"].errors.length, 0);

const build = await json("docs/evidence/contract-build.json");
assert.equal(Object.keys(build.contracts).length, 4, "All four prototype contracts are required");
for (const [file, expected] of Object.entries(build.sources)) {
  assert.equal(hash(await readFile(join(project, file))), expected, "Stale contract source: " + file);
}
for (const [file, expected] of Object.entries(build.contracts)) {
  const bytes = await readFile(join(project, "res", file));
  assert.equal(hash(bytes), expected.sha256, "Stale Wasm: " + file);
  assert.equal(bytes.length, expected.bytes);
}
assert.deepEqual(reports["browser-tests"].contractBuild.contracts, build.contracts);
assert.ok(Date.parse(reports["lending-tests"].checkedAt) >= Date.parse(build.builtAt));

const capture = await json("demo-video/capture-borrow.json");
const delivery = await json("demo-video/evidence/delivery.json");
assert.equal(capture.status, "PASS");
assert.equal(capture.errors.length, 0);
assert.equal(capture.clips.length, 11);
assert.equal(capture.original.principal, "1000000000");
for (const [file, expected] of Object.entries(capture.sources || {})) {
  assert.equal(hash(await readFile(join(project, file))), expected, "Recording source changed: " + file);
}
assert.equal(delivery.status, "PASS");
assert.equal(delivery.durationSeconds, 120);
assert.equal(delivery.width, 1920);
assert.equal(delivery.height, 1080);
assert.equal(delivery.frameCount, 3600);
assert.equal(delivery.compositionCheck.ok, true);
assert.equal(delivery.compositionCheck.browserSkipped, false);
for (const [file, expected] of Object.entries(delivery.compositionSources || {})) {
  assert.equal(hash(await readFile(join(project, "demo-video", file))), expected, "Rendered source changed: " + file);
}
const video = await readFile(join(project, "demo-video/renders/lockpad-demo.mp4"));
assert.equal(hash(video), delivery.sha256, "The demo video differs from its verified export");

await writeFile(join(project, "docs/evidence/verification.json"), JSON.stringify({
  schema: "lockpad-local-verification-v2",
  status: "PASS",
  verifiedAt: new Date().toISOString(),
  scope: "Four-contract borrow-or-sell prototype with real local NEAR Sandbox execution",
  unitTests: { count: reports["unit-tests"].passed, executedAt: reports["unit-tests"].executedAt },
  lendingBehaviors: { count: reports["lending-tests"].checks.length, executedAt: reports["lending-tests"].checkedAt },
  browserBehaviors: { count: reports["browser-tests"].checks.length, executedAt: reports["browser-tests"].executedAt, errors: 0 },
  historicalThreeContractRelease: { count: reports["release-tests"].checks.length, executedAt: reports["release-tests"].executedAt, scope: "Optional token/vault/market executor; does not deploy the lending pool" },
  contracts: build.contracts,
  recording: { checks: capture.checks.length, recordedAt: capture.recordedAt, errors: 0 },
  video: { seconds: delivery.durationSeconds, frames: delivery.frameCount, sha256: delivery.sha256, fullDecode: delivery.fullDecode, listeningReviewed: delivery.audio.listeningReviewed },
  sourceDestination: "https://github.com/grey-labz/lockpad",
  publicDeployment: "No public contract deployment; Q-012 local-only demo path",
  application: "Prepared for the user to enter personal fields and publish the X demo post; not sent",
  actors: "Temporary builder-controlled accounts and zero-value tokens; no independent adoption",
}, null, 2) + newline);

const outputs = join(project, "outputs");
await mkdir(outputs, { recursive: true });
const directory = process.argv[2]
  ? resolve(process.argv[2])
  : await mkdtemp(join(outputs, "submission-2026-11-13-"));
await mkdir(directory, { recursive: true });
const sourceRoot = join(directory, "source", "lockpad");
await mkdir(sourceRoot, { recursive: true });
const { stdout } = await run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: project });
const files = [...new Set(stdout.split(String.fromCharCode(0)).filter(Boolean))].sort().filter(file => file !== "docs/evidence/submission-package.json");
const sourceManifest = {};
for (const file of files) {
  assert.ok(!file.split("/").some(part => [".git", ".atlas", ".demo", ".release", "node_modules", "target", "dist", "outputs", "work", "credentials", "testnet-keys"].includes(part)), "Private/generated path: " + file);
  assert.ok(!file.startsWith(".env") || file === ".env.example", "Private environment file: " + file);
  assert.ok((await lstat(join(project, file))).isFile(), "Non-file source entry: " + file);
  const bytes = await readFile(join(project, file));
  if (!/[.](wasm|png|webp|ttf|woff2?|jpg|jpeg)$/.test(file)) {
    const text = credentialScanText(file, bytes);
    assert.ok(!/ed25519:[1-9A-HJ-NP-Za-km-z]{75,100}/.test(text), "Private NEAR key in " + file);
    assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text), "Private key in " + file);
    assert.ok(!/(?:sk_[A-Za-z0-9_-]{25,}|gh[pousr]_[A-Za-z0-9]{30,})/.test(text), "API credential in " + file);
  }
  const target = join(sourceRoot, file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(project, file), target);
  sourceManifest[file] = { bytes: bytes.length, sha256: hash(bytes) };
}
await writeFile(join(sourceRoot, "SOURCE-MANIFEST.json"), JSON.stringify(sourceManifest, null, 2) + newline);
await run("zip", ["-qr", join(directory, "lockpad-source.zip"), "lockpad"], { cwd: dirname(sourceRoot) });
await run("zip", ["-T", join(directory, "lockpad-source.zip")]);

await copyFile(join(project, "demo-video/renders/lockpad-demo.mp4"), join(directory, "lockpad-demo.mp4"));
await copyFile(join(project, "demo-video/renders/lockpad-demo-editable.zip"), join(directory, "lockpad-demo-editable.zip"));
await copyFile(join(project, "SUBMISSION.md"), join(directory, "submission-copy.md"));
const archives = {};
for (const name of ["lockpad-source.zip", "lockpad-demo.mp4", "lockpad-demo-editable.zip", "submission-copy.md"]) {
  const bytes = await readFile(join(directory, name));
  archives[name] = { bytes: bytes.length, sha256: hash(bytes) };
}
const manifest = {
  schema: "lockpad-local-submission-v1",
  status: "PASS",
  packagedAt: new Date().toISOString(),
  sourceUrl: "https://github.com/grey-labz/lockpad",
  sourceFiles: files.length,
  scope: "Four-contract, local NEAR Sandbox borrow-or-sell prototype; no public contract deployment",
  tests: {
    unit: reports["unit-tests"].passed,
    lending: reports["lending-tests"].checks.length,
    browser: reports["browser-tests"].checks.length,
    historicalThreeContractRelease: reports["release-tests"].checks.length,
  },
  video: { seconds: delivery.durationSeconds, width: 1920, height: 1080, fps: 30, narration: delivery.narration, listeningReviewed: delivery.audio.listeningReviewed },
  application: "Not submitted; the user enters personal fields and publishes the X demo post",
  archives,
};
await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + newline);
await run("zip", ["-q", join(directory, "lockpad-submission.zip"), ...Object.keys(archives), "manifest.json"], { cwd: directory });
await run("zip", ["-T", join(directory, "lockpad-submission.zip")]);
await writeFile(join(project, "docs/evidence/submission-package.json"), JSON.stringify({
  ...manifest,
  packageDirectory: directory,
  submissionArchive: { bytes: (await lstat(join(directory, "lockpad-submission.zip"))).size, sha256: hash(await readFile(join(directory, "lockpad-submission.zip"))) },
}, null, 2) + newline);
console.log(JSON.stringify({ status: "PASS", directory, sourceFiles: files.length, archives }, null, 2));
console.log(`Credential scan passed; ${publicSignatures} public NEAR transaction signatures retained in receipt evidence.`);
