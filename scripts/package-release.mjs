import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { build } from "vite";
import { readReleasePlan, saveJSON, sha256, project } from "./lib/release.mjs";

const execute = promisify(execFile);
const [planPath, outputPath] = process.argv.slice(2);
if (!planPath) throw new Error("Usage: npm run release:bundle -- PLAN.json [OUTPUT_DIRECTORY]. Bundles the verified local source and an unpublished configured site; no network writes occur.");
const plan = await readReleasePlan(resolve(planPath));
if (plan.network !== "testnet") throw new Error("The release package needs the reviewed public-testnet plan.");
const stamp = new Date().toISOString().replace(/[-:.]/g, "");
const directory = resolve(outputPath || join(project, ".release", plan.id.slice(0, 12), "bundle-" + stamp));
await mkdir(directory, { recursive: true });

const reports = {};
for (const name of ["contract-build", "contract-tests", "browser-tests", "unit-tests", "release-tests"]) reports[name] = JSON.parse(await readFile(join(project, "docs/evidence", name + ".json"), "utf8"));
for (const name of ["browser-tests", "unit-tests", "release-tests"]) {
  assert.equal(reports[name].status, "PASS", `${name} must pass before packaging`);
  assert.ok(Object.keys(reports[name].sources || {}).length > 0, `${name} must record its source hashes`);
  for (const [file, hash] of Object.entries(reports[name].sources)) assert.equal(sha256(await readFile(join(project, file))), hash, `${file} changed after ${name}; run that check again`);
}
assert.equal(reports["browser-tests"].errors.length, 0);
assert.deepEqual(reports["browser-tests"].contractBuild.contracts, reports["contract-build"].contracts, "Browser evidence covers an earlier Wasm build");
assert.ok(Date.parse(reports["contract-tests"].executedAt) >= Date.parse(reports["contract-build"].builtAt), "Contract execution predates the reviewed build");
for (const contract of plan.contracts) assert.equal(reports["release-tests"].verification.contracts.find(item => item.role === contract.role)?.sha256, contract.sha256, "Deployment rehearsal covers a different artifact");
const verification = {
  status: "PASS", verifiedAt: new Date().toISOString(), releaseId: plan.id,
  unitTests: { count: reports["unit-tests"].tests, executedAt: reports["unit-tests"].executedAt },
  contractBehaviors: { count: reports["contract-tests"].checks.length, executedAt: reports["contract-tests"].executedAt, scope: "Saved real Sandbox execution; current contract sources and artifacts still match" },
  browserBehaviors: { count: reports["browser-tests"].checks.length, executedAt: reports["browser-tests"].executedAt, viewports: [1440, 768, 390, 320] },
  releaseBehaviors: { count: reports["release-tests"].checks.length, executedAt: reports["release-tests"].executedAt, deploymentSignatures: reports["release-tests"].signatures, deploymentBroadcasts: reports["release-tests"].broadcasts },
  contracts: plan.contracts.map(({ role, file, sha256, codeHash }) => ({ role, file, sha256, codeHash })),
  hackathonPath: "Reproducible local build, public source and working X demo video (Q-012)", publicDeployment: "Optional; not requested for the current hackathon path", publication: "Current source awaits explicit human confirmation", submission: "Not submitted by this continuation", actors: "Temporary builder-controlled local fixtures; no public wallet acceptance or independent adoption", packageDirectory: directory,
};
await writeFile(join(project, "docs/evidence/verification.json"), JSON.stringify(verification, null, 2) + "\n");

const sourceDirectory = join(directory, "source/lockpad"), siteDirectory = join(directory, "site");
const { stdout } = await execute("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: project, maxBuffer: 8 * 1024 * 1024 });
const files = [...new Set(stdout.split("\0").filter(Boolean))].sort().filter(file => !["docs/screenshots/browser-failure.png"].includes(file));
const sourceManifest = {};
for (const file of files) {
  assert.ok(!file.split("/").some(segment => [".git", "node_modules", ".demo", ".release", "credentials", "testnet-keys", "outputs", "work"].includes(segment)), "An ignored or private directory entered the source package");
  assert.ok(!file.startsWith(".env") || file === ".env.example", "An environment file entered the source package");
  assert.ok((await lstat(join(project, file))).isFile(), `Only ordinary files can be published: ${file}`);
  const bytes = await readFile(join(project, file));
  if (!/\.(wasm|png|webp|ttf|woff2?|jpg|jpeg)$/.test(file)) {
    const text = bytes.toString("utf8");
    const privateKey = file.endsWith(".json") ? /(?:private_key|privateKey|secret_key)"\s*:\s*"(?:ed25519:)?[1-9A-HJ-NP-Za-km-z]{75,100}/ : /ed25519:[1-9A-HJ-NP-Za-km-z]{75,100}/;
    assert.ok(!privateKey.test(text) && !/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text), `A private credential was found in ${file}`);
  }
  const target = join(sourceDirectory, file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(project, file), target);
  sourceManifest[file] = { bytes: bytes.length, sha256: sha256(bytes) };
}
Object.assign(process.env, plan.frontend, { VITE_DEMO: "0" });
await build({ root: project, build: { outDir: siteDirectory, emptyOutDir: false } });
await saveJSON(join(siteDirectory, "release-plan.json"), plan);
await saveJSON(join(siteDirectory, "release-status.json"), { ...verification, publicDeployment: "Not deployed; this is an offline release preview", packageDirectory: undefined });

async function hashes(root) {
  const result = {};
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await visit(file);
      else result[relative(root, file)] = sha256(await readFile(file));
    }
  }
  await visit(root); return result;
}
await execute("zip", ["-qr", join(directory, "lockpad-source.zip"), "lockpad"], { cwd: dirname(sourceDirectory) });
await execute("zip", ["-qr", join(directory, "lockpad-site.zip"), "."], { cwd: siteDirectory });
const manifest = { schema: "lockpad-release-package-v1", releaseId: plan.id, packagedAt: new Date().toISOString(), status: "PASS", source: sourceManifest, site: await hashes(siteDirectory), archives: {} };
for (const file of ["lockpad-source.zip", "lockpad-site.zip"]) {
  const bytes = await readFile(join(directory, file));
  manifest.archives[file] = { bytes: bytes.length, sha256: sha256(bytes) };
}
await saveJSON(join(directory, "manifest.json"), manifest);
await saveJSON(join(directory, "plan.json"), plan);
const planPreflight = join(resolve(planPath, ".."), "preflight.json");
try { await copyFile(planPreflight, join(directory, "preflight.json")); } catch (error) { if (error.code !== "ENOENT") throw error; }
await writeFile(join(directory, "README.md"), `# Lockpad release candidate\n\nThis package is unpublished. The current contracts have not been deployed to public testnet.\n\n- Source and saved local evidence: lockpad-source.zip\n- Configured static preview: lockpad-site.zip\n- Reviewed three-contract deployment: plan.json\n- Exact file and archive hashes: manifest.json\n\nRun the source package with Node 22.12+ and npm ci --ignore-scripts, then npm run demo. All source and test actors are local builder fixtures. The public release procedure is in source/lockpad/docs/RELEASE.md.\n`);
console.log(JSON.stringify({ status: "PASS", directory, releaseId: plan.id, files: files.length, archives: manifest.archives, verification }, null, 2));
