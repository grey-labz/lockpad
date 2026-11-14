import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { resolve, relative, join } from "node:path";
import { chromium } from "playwright";
import { startDemoServer } from "../scripts/demo-server.mjs";

const exec = promisify(execFile);
const project = import.meta.dirname;
const take = "borrow-" + new Date().toISOString().replaceAll(":", "-");
const footage = join(project, "assets/footage", take);
await mkdir(footage, { recursive: true });
const reportFile = join(project, "capture-borrow.json");
const report = { status: "RECORDING", recordedAt: new Date().toISOString(), network: "isolated local NEAR Sandbox", testToken: "TUSD — no monetary value", actors: "Temporary builder-controlled accounts", viewport: { width: 1536, height: 864 }, clips: [], checks: [], errors: [] };
let server, browser, page, recording = false;
const pause = milliseconds => page.waitForTimeout(milliseconds);
const check = name => { report.checks.push(name); console.log("VERIFIED:", name); };
const position = () => server.vault.view("get_position", { token_id: "1" });
const balance = account => server.token.view("ft_balance_of", { account_id: account });
const marketAccount = account => server.market.view("get_account", { account_id: account });
async function notice(text) { await page.waitForFunction(text => document.querySelector(".notice")?.textContent.includes(text), text, { timeout: 60000 }); }
async function dismiss() { const button = page.getByRole("button", { name: "Dismiss notification", exact: true }); if (await button.isVisible()) await button.click(); }
async function route(path) { await page.evaluate(path => { location.hash = path; }, path); await page.locator("main h1").waitFor(); await page.evaluate(() => { window.scrollTo({ top: 0, behavior: "instant" }); return document.fonts.ready; }); }
async function choose(name) {
  await page.locator(".wallet-button").click(); await pause(400);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(name => document.querySelector(".wallet-button")?.textContent.includes(name.toLowerCase()), name);
}
async function portfolio() { await route("/positions"); await page.locator(".balances-grid").waitFor(); await page.waitForFunction(() => !document.querySelector(".page-heading button")?.disabled); }
async function film(id, minimum, action) {
  console.log("RECORDING:", id);
  const path = join(footage, id + ".webm");
  await page.screencast.start({ path, size: report.viewport, fps: 30, quality: 95 }); recording = true;
  await page.screencast.showActions({ cursor: "pointer", duration: 380, style: { highlight: "outline: 2px solid #16db65; outline-offset: 3px; border-radius: 8px;", title: "display: none;" } });
  const start = performance.now();
  await action();
  await pause(Math.max(700, minimum * 1000 - (performance.now() - start)));
  const still = join(footage, id + ".png"); await page.screenshot({ path: still });
  await page.screencast.stop(); recording = false;
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", path]);
  const duration = Number(JSON.parse(stdout).format.duration); assert.ok(duration > 0);
  report.clips.push({ id, src: relative(project, path), duration, still: relative(project, still) });
  await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
}

try {
  server = await startDemoServer({ port: 0 });
  const alice = server.accounts.alice.accountId, bob = server.accounts.bob.accountId;
  report.accounts = server.config.accounts;
  report.contracts = { vault: server.vault.accountId, pool: server.pool.accountId, market: server.market.accountId, token: server.token.accountId };
  const original = await position(), vaultBefore = await balance(server.vault.accountId);
  const initialReceipts = new Set(server.receipts.keys());
  report.original = original; report.vaultBalanceBefore = vaultBefore;
  assert.equal(original.principal, "1000000000"); assert.equal(original.owner_id, alice);
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: report.viewport, deviceScaleFactor: 1, locale: "en-US", timezoneId: "Africa/Lagos" });
  await context.route("**/*", handler => {
    const host = new URL(handler.request().url()).hostname;
    if (!["127.0.0.1", "localhost"].includes(host)) { report.errors.push("Unexpected external app request: " + host); return handler.abort(); }
    return handler.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(60000);
  page.on("pageerror", error => report.errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") report.errors.push(message.text()); });
  await page.goto(server.url); await page.locator(".home-market .position-card").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.match(await page.locator(".network-bar").textContent(), /Local NEAR Sandbox/);
  assert.match(await page.locator(".hero-comparison").textContent(), /Illustrative example/);
  await film("intro", 11, async () => { await pause(1600); await page.locator(".hero-actions .primary").hover(); await pause(1400); });

  await choose("Alice"); await portfolio();
  await page.getByRole("button", { name: "Get test tokens", exact: true }).click(); await notice("Test tokens added"); await dismiss();
  report.setup = "Alice used the app's zero-value faucet to hold enough test tokens for the eventual repayment fee.";
  const aliceBefore = BigInt(await balance(alice)); report.aliceBefore = aliceBefore.toString();
  await film("source", 12, async () => {
    await page.locator('[data-position-id="1"]').scrollIntoViewIfNeeded(); await pause(1600);
    assert.equal((await position()).unlock_at, original.unlock_at);
    const accounting = await server.pool.view("get_accounting", {});
    assert.equal(accounting.available_liquidity, "1000000000"); report.initialPoolAccounting = accounting;
    check("Four deployed local NEAR contracts include a pool funded with 1,000 actual zero-value TUSD");
  });
  await film("quote", 13, async () => {
    await page.locator('[data-position-id="1"]').getByRole("button", { name: "Borrow", exact: true }).click();
    await page.locator(".offer-maximum").waitFor(); await pause(1500);
    assert.match(await page.locator(".offer-maximum").textContent(), /650/);
    assert.match(await page.locator(".repayment-total").textContent(), /663/);
    await page.getByLabel("Amount to borrow").hover(); await pause(1500);
    check("An authoritative funded-pool quote offers 650 TUSD with a 13 TUSD fee and 663 due");
  });
  let loan;
  await film("borrow", 11, async () => {
    await page.getByRole("button", { name: "Review borrowing offer" }).click(); await pause(1200);
    await page.getByRole("button", { name: /Confirm borrow/ }).click(); await page.locator("dialog").waitFor({ state: "hidden" }); await notice("TUSD borrowed");
    loan = (await server.pool.view("get_loans_by_borrower", { borrower_id: alice, from_index: 0, limit: 100 }))[0];
    assert.equal(loan.status, "Active"); assert.equal(loan.amount, "650000000"); assert.equal(loan.repay_amount, "663000000");
    assert.equal((await position()).owner_id, server.pool.accountId);
    assert.equal((await position()).unlock_at, original.unlock_at); assert.equal(await balance(server.vault.accountId), vaultBefore);
    assert.equal(BigInt(await balance(alice)), aliceBefore + 650000000n);
    await page.locator(".loan-card").scrollIntoViewIfNeeded(); await pause(1500);
    report.loan = loan; check("Alice receives the actual 650 TUSD loan while the pool holds only the original payout NFT");
  });
  await dismiss();
  await film("repay", 11, async () => {
    await page.getByRole("button", { name: "Repay 663 TUSD", exact: true }).click(); await pause(1200);
    await page.getByRole("button", { name: /Confirm repayment/ }).click(); await page.locator("dialog").waitFor({ state: "hidden" }); await notice("Loan repaid");
    assert.equal((await server.pool.view("get_loan", { loan_id: loan.id })).status, "Repaid");
    const returned = await position();
    assert.equal(returned.owner_id, alice); assert.equal(returned.principal, original.principal); assert.equal(returned.unlock_at, original.unlock_at);
    assert.equal(BigInt(await balance(alice)), aliceBefore - 13000000n);
    assert.equal(await balance(server.vault.accountId), vaultBefore);
    await page.locator('[data-position-id="1"]').scrollIntoViewIfNeeded(); await pause(1200);
    report.repaid = returned; check("663 TUSD repayment returns the same NFT, principal, and original maturity to Alice");
  });
  await dismiss();
  let sale;
  await film("listing", 13, async () => {
    await page.locator('[data-position-id="1"]').getByRole("button", { name: "Borrow", exact: true }).click();
    await page.locator(".offer-maximum").waitFor(); await pause(900);
    await page.getByRole("button", { name: "List this position instead" }).click(); await pause(700);
    await page.getByLabel("Sale price").pressSequentially("920", { delay: 120 }); await pause(900);
    await page.getByRole("button", { name: "Review listing", exact: true }).click(); await pause(1000);
    await page.getByRole("button", { name: "Confirm listing", exact: true }).click(); await page.locator("dialog").waitFor({ state: "hidden" }); await notice("Your position is listed");
    sale = (await server.market.view("get_listings_by_seller", { seller_id: alice, from_index: 0, limit: 100 }))[0];
    assert.equal(sale.price, "920000000"); assert.equal(sale.unlock_at, original.unlock_at);
    assert.equal((await position()).owner_id, server.market.accountId); assert.equal(await balance(server.vault.accountId), vaultBefore);
    assert.equal((await marketAccount(alice)).proceeds, "0"); report.sale = sale;
    check("The sale alternative lists the same payout right for 920; a listing alone releases no proceeds");
  });
  await dismiss();
  await film("purchase", 12, async () => {
    await choose("Bob"); await route("/position/" + sale.id); await page.getByRole("button", { name: "Review purchase", exact: true }).waitFor(); await pause(900);
    await page.getByRole("button", { name: "Review purchase", exact: true }).click(); await pause(1000);
    await page.getByRole("button", { name: /Confirm purchase/ }).click(); await page.locator("dialog").waitFor({ state: "hidden" }); await notice("Position purchased");
    const bought = await position(); assert.equal(bought.owner_id, bob); assert.equal(bought.principal, original.principal); assert.equal(bought.unlock_at, original.unlock_at);
    assert.equal((await marketAccount(alice)).proceeds, "920000000"); assert.equal(await balance(bob), "80000000");
    report.purchased = bought; check("Bob receives the original NFT before 920 TUSD becomes withdrawable by Alice");
  });
  await dismiss();
  await film("seller", 9, async () => {
    await choose("Alice"); await portfolio();
    const before = BigInt(await balance(alice));
    await page.getByRole("button", { name: "Withdraw proceeds", exact: true }).click(); await pause(1100);
    await page.getByRole("button", { name: "Confirm withdrawal", exact: true }).click(); await page.locator("dialog").waitFor({ state: "hidden" }); await notice("Sale proceeds arrived");
    const after = BigInt(await balance(alice)); assert.equal(after - before, 920000000n); assert.equal((await marketAccount(alice)).proceeds, "0");
    assert.equal(await balance(server.vault.accountId), vaultBefore);
    report.sellerPayment = { amount: "920000000", walletBefore: before.toString(), walletAfter: after.toString() };
    check("Alice's actual withdrawal delivers exactly 920 TUSD without touching the source principal");
  });
  await dismiss(); await choose("Bob"); await portfolio();
  await film("maturity", 6, async () => {
    assert.equal(await page.locator('[data-position-id="1"]').getByRole("button", { name: "Claim payout" }).count(), 0);
    const before = (await server.vault.view("get_config", {})).timestamp;
    await pause(1200); await server.worker.provider.fastForward(600);
    await page.getByRole("button", { name: "Refresh positions" }).click();
    await page.locator('[data-position-id="1"]').getByRole("button", { name: "Claim payout" }).waitFor();
    assert.equal((await position()).unlock_at, original.unlock_at);
    report.maturity = { method: "Local Sandbox fastForward(600)", before, after: (await server.vault.view("get_config", {})).timestamp, originalUnlockAt: original.unlock_at };
    check("Only local Sandbox time advances; the original source maturity stays unchanged");
  });
  await film("claim", 9, async () => {
    await page.locator('[data-position-id="1"]').getByRole("button", { name: "Claim payout" }).click(); await pause(1000);
    await page.getByRole("button", { name: "Confirm maturity claim", exact: true }).click(); await page.locator("dialog").waitFor({ state: "hidden" }); await notice("The full maturity payout arrived");
    assert.equal(await balance(bob), "1080000000"); assert.equal((await position()).status, "Redeemed");
    assert.equal((await position()).unlock_at, original.unlock_at);
    report.redeemed = await position(); report.buyerPayout = "1000000000";
    check("Bob receives the actual 1,000 TUSD source payout and holds 1,080 TUSD after redemption");
  });
  await dismiss();
  await film("activity", 13, async () => {
    await route("/activity"); await page.locator(".activity-row").first().waitFor(); await pause(2000);
    await route("/sources"); await page.getByRole("heading", { name: "Non-transferable DEX positions" }).scrollIntoViewIfNeeded(); await pause(1700);
    check("The actual app shows native receipts and the adapter requirement for non-transferable DEX positions");
  });
  assert.deepEqual(report.errors, []);
  report.status = "PASS"; report.completedAt = new Date().toISOString(); report.sources = {};
  for (const file of ["src/app.jsx", "src/style.css", "src/theme.css", "src/borrow.jsx", "src/hooks/use-lockpad.js", "src/lib/lending.mjs", "scripts/demo-server.mjs", "scripts/sandbox.mjs"]) report.sources[file] = createHash("sha256").update(await readFile(resolve(project, "..", file))).digest("hex");
  report.transactions = [...server.receipts.values()].filter(receipt => !initialReceipts.has(receipt.transaction.hash));
  report.poolAccounting = await server.pool.view("get_accounting", {});
  report.marketAccounting = await server.market.view("get_accounting", {});
  console.log("CAPTURE PASS:", report.clips.length, "real app chapters;", report.checks.length, "verified source and settlement checks.");
} catch (error) {
  report.status = "FAIL"; report.error = error.stack || error.message; process.exitCode = 1; console.error(error);
  if (page) { if (recording) try { await page.screencast.stop(); } catch {} try { await page.screenshot({ path: join(footage, "failure.png"), fullPage: true }); } catch {} }
} finally {
  await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
  if (browser) await browser.close(); if (server) await server.close();
}
