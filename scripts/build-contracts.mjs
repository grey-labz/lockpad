import { execFileSync, spawn } from "node:child_process";
import { access, mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const project = resolve(import.meta.dirname, "..");
const command = ["build", "-Z", "build-std=std,panic_abort", "--release", "--target", "wasm32-unknown-unknown"];
if (!process.argv.includes("--update-lock")) command.push("--locked");
console.log("Building the marketplace, reference vault, and test token for the NEAR Wasm MVP runtime…");
const child = spawn("cargo", command, { cwd: project, env: { ...process.env, RUSTC_BOOTSTRAP: "1" }, stdio: "inherit" });
const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
if (code !== 0) process.exit(code || 1);
const files = ["lockpad_marketplace.wasm", "lockpad_reference_vault.wasm", "lockpad_test_token.wasm"];
const manifest = { builtAt: new Date().toISOString(), toolchain: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim() + "; Wasm MVP; build-std=std,panic_abort", contracts: {} };
await mkdir(resolve(project, "res"), { recursive: true });
for (const file of files) {
  const path = resolve(project, "target/wasm32-unknown-unknown/release", file);
  await access(path, constants.R_OK);
  const buffer = await readFile(path);
  manifest.contracts[file] = { bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
  await copyFile(path, resolve(project, "res", file));
}
manifest.sources = {};
for (const file of ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml", ".cargo/config.toml", "contract/Cargo.toml", "contract/src/lib.rs", "marketplace/Cargo.toml", "marketplace/src/lib.rs", "token/Cargo.toml", "token/src/lib.rs"]) {
  manifest.sources[file] = createHash("sha256").update(await readFile(resolve(project, file))).digest("hex");
}
await mkdir(resolve(project, "docs/evidence"), { recursive: true });
await writeFile(resolve(project, "docs/evidence/contract-build.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
