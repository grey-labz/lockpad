import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { startDemoServer } from "./demo-server.mjs";
import { OPERATION_STORAGE, project } from "./sandbox.mjs";

const checks = [], errors = [], requests = [], screenshots = [];
const report = { network: "isolated local NEAR Sandbox", actors: "Temporary builder-controlled wallets; no independent adoption", checks, errors, screenshots };
const evidence = join(project, "docs/evidence");
const captures = join(project, "docs/screenshots");
await mkdir(evidence, { recursive: true });
await mkdir(captures, { recursive: true });
let server, browser, page, publicServer;
const record = name => { checks.push(name); console.log("PASS:", name); };

async function screenshot(name) {
  const path = join(captures, name + ".png");
  await page.screenshot({ path, fullPage: true });
  screenshots.push("docs/screenshots/" + name + ".png");
}
async function notice(text) {
  await page.waitForFunction(text => document.querySelector(".notice")?.textContent.includes(text), text, { timeout: 60000 });
}
async function route(path) {
  await page.evaluate(path => { location.hash = path; }, path);
  await page.waitForFunction(path => location.hash === "#" + path, path);
  await page.locator("main h1").waitFor({ state: "visible" });
}
async function choose(name) {
  await page.locator(".wallet-button").click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(name => document.querySelector(".wallet-button")?.textContent.includes(name.toLowerCase()), name);
}
async function portfolio() {
  await route("/positions");
  await page.locator(".balances-grid").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Create test position", exact: true }).waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector(".page-heading button")?.disabled);
}
const tokenBalance = account => server.token.view("ft_balance_of", { account_id: account });
const getPosition = tokenId => server.vault.view("get_position", { token_id: tokenId });
const ledger = account => server.market.view("get_account", { account_id: account });
const txCount = method => [...server.receipts.values()].filter(receipt => receipt.transaction.actions.some(action => action.FunctionCall?.method_name === method)).length;

async function startPublicPreview() {
  const directory = resolve(project, "dist");
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".ttf": "font/ttf" };
  const http = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (!path.startsWith("/timeshift/")) { response.writeHead(404); response.end(); return; }
      const file = resolve(directory, path.slice("/timeshift/".length) || "index.html");
      if (!file.startsWith(directory + sep)) { response.writeHead(403); response.end(); return; }
      const body = await readFile(file);
      response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { http.once("error", reject); http.listen(0, "127.0.0.1", resolve); });
  return { url: "http://127.0.0.1:" + http.address().port + "/timeshift/", close: () => new Promise(resolve => http.close(resolve)) };
}

try {
  server = await startDemoServer({ port: 0 });
  report.accounts = server.config.accounts;
  const alice = server.accounts.alice.accountId, bob = server.accounts.bob.accountId;
  const original = await getPosition("1");
  const originalVaultBalance = await tokenBalance(server.vault.accountId);
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await context.route("**/*", handler => {
    const url = new URL(handler.request().url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") { requests.push(url.origin); return handler.abort(); }
    return handler.continue();
  });
  await page.goto(server.url);
  await page.locator(".position-card").first().waitFor({ state: "visible" });
  assert.equal(await page.locator(".home-market .position-card").count(), 3);
  assert.match(await page.locator(".network-bar").textContent(), /Local NEAR Sandbox/);
  assert.match(await page.locator(".hero-comparison").textContent(), /Illustrative example/);
  await screenshot("home-desktop");
  record("Home distinguishes illustrative borrowing and sale amounts from actual local listings");

  await route("/marketplace");
  await page.getByLabel("Sort positions").selectOption("discount");
  assert.equal(await page.locator(".position-card").first().getAttribute("data-listing-id"), "3");
  await page.getByLabel("Filter by maturity").selectOption("week");
  assert.equal(await page.locator(".position-card").count(), 1);
  await page.getByLabel("Filter by discount").selectOption("5");
  await page.getByRole("heading", { name: "No positions match these filters" }).waitFor();
  assert.equal(await page.locator(".position-card").count(), 0);
  await page.getByRole("button", { name: "Reset filters" }).click();
  await page.getByLabel("Search positions").fill("nora.test.near");
  assert.equal(await page.locator(".position-card").count(), 3);
  await page.getByLabel("Search positions").fill("unknown-seller");
  assert.equal(await page.locator(".position-card").count(), 0);
  await page.getByRole("button", { name: "Reset filters" }).click();
  record("Search, maturity, exact discount filters and sorting use real market data");

  await choose("Alice");
  await portfolio();
  await page.getByRole("button", { name: "Get test tokens", exact: true }).click();
  await notice("Test tokens added");
  const aliceBeforeBorrow = BigInt(await tokenBalance(alice));
  await page.locator('[data-position-id="1"]').getByRole("button", { name: "Borrow", exact: true }).click();
  await page.locator(".offer-maximum").waitFor();
  assert.match(await page.locator(".offer-maximum").textContent(), /650/);
  assert.match(await page.locator(".repayment-total").textContent(), /663/);
  await screenshot("borrow-desktop");
  await page.getByLabel("Amount to borrow").fill("651");
  assert.equal(await page.getByRole("button", { name: "Review borrowing offer" }).isDisabled(), true);
  await page.getByLabel("Amount to borrow").fill("650");
  const beforeBorrowReview = server.receipts.size;
  await page.getByRole("button", { name: "Review borrowing offer" }).click();
  await page.keyboard.press("Escape");
  assert.equal(server.receipts.size, beforeBorrowReview);
  record("The borrowing quote enforces the actual collateral limit and review never signs");

  await page.getByRole("button", { name: "Review borrowing offer" }).click();
  const beforeStaleQuote = txCount("nft_transfer_call");
  await server.send(server.accounts.nora, server.token, "ft_transfer_call", { receiver_id: server.pool.accountId, amount: "1000000", msg: JSON.stringify({ action: "fund" }) });
  await page.getByRole("button", { name: /Confirm borrow/ }).click();
  await page.locator("dialog").getByRole("alert").waitFor({ state: "visible", timeout: 60000 });
  assert.match(await page.locator("dialog").getByRole("alert").textContent(), /quote changed/);
  assert.equal(txCount("nft_transfer_call"), beforeStaleQuote);
  assert.equal((await getPosition("1")).owner_id, alice);
  await page.waitForFunction(() => !document.querySelector("dialog .icon-button")?.disabled);
  await page.keyboard.press("Escape");
  await page.locator(".offer-maximum").waitFor();
  record("A changed funded-pool quote is rejected before the original payout NFT moves");

  await page.getByRole("button", { name: "Review borrowing offer" }).click();
  await page.getByRole("button", { name: /Confirm borrow/ }).evaluate(button => { button.click(); button.click(); });
  await page.locator("dialog").waitFor({ state: "hidden", timeout: 60000 });
  await notice("TUSD borrowed");
  const loan = (await server.pool.view("get_loans_by_borrower", { borrower_id: alice, from_index: 0, limit: 100 }))[0];
  assert.equal(loan.status, "Active");
  assert.equal(loan.amount, "650000000");
  assert.equal(loan.repay_amount, "663000000");
  assert.equal((await getPosition("1")).owner_id, server.pool.accountId);
  assert.equal((await getPosition("1")).unlock_at, original.unlock_at);
  assert.equal(await tokenBalance(server.vault.accountId), originalVaultBalance);
  assert.equal(BigInt(await tokenBalance(alice)), aliceBeforeBorrow + 650000000n);
  assert.equal(txCount("draw_loan"), 1);
  assert.equal(await page.locator('[data-position-id="1"]').count(), 0);
  await screenshot("loan-active-desktop");
  const beforeLoanReload = server.receipts.size;
  await page.reload();
  await page.locator('[data-loan-id="' + loan.id + '"]').waitFor();
  assert.equal(server.receipts.size, beforeLoanReload);
  record("A double press borrows once, keeps principal and maturity unchanged, and reload cannot reborrow");

  await choose("Bob");
  await route("/borrow");
  await page.getByRole("heading", { name: "No eligible position in this wallet" }).waitFor();
  assert.equal(await page.locator(".offer-maximum").count(), 0);
  assert.equal(await page.locator(".loan-card").count(), 0);
  await choose("Alice");
  await portfolio();
  await page.getByRole("button", { name: "Repay 663 TUSD", exact: true }).click();
  await page.getByRole("button", { name: /Confirm repayment/ }).click();
  await page.locator("dialog").waitFor({ state: "hidden", timeout: 60000 });
  await notice("Loan repaid");
  assert.equal((await server.pool.view("get_loan", { loan_id: loan.id })).status, "Repaid");
  const repaid = await getPosition("1");
  assert.equal(repaid.owner_id, alice);
  assert.equal(repaid.principal, original.principal);
  assert.equal(repaid.unlock_at, original.unlock_at);
  assert.equal(await tokenBalance(server.vault.accountId), originalVaultBalance);
  assert.equal(BigInt(await tokenBalance(alice)), aliceBeforeBorrow - 13000000n);
  await screenshot("loan-repaid-desktop");
  report.borrowing = { loan, original, repaid, actualDisbursement: "650000000", actualRepayment: "663000000" };
  record("Wallet changes clear borrowing offers, and repayment returns the same source payout NFT");

  await page.locator('[data-position-id="1"]').getByRole("button", { name: "Borrow", exact: true }).click();
  await page.locator(".offer-maximum").waitFor();
  await page.getByRole("button", { name: "List this position instead" }).click();
  assert.match(await page.locator(".selected-summary").textContent(), /Reference position #1/);
  record("The sale alternative carries the quoted position directly into the listing form");
  await page.getByLabel("Sale price").fill("1000");
  assert.equal(await page.getByRole("button", { name: "Review listing" }).isDisabled(), true);
  await page.getByLabel("Sale price").fill("920");
  assert.match(await page.locator(".quote-summary").textContent(), /8\.00%/);
  assert.match(await page.locator(".quote-summary").textContent(), /8\.70%/);
  const beforeReview = server.receipts.size;
  await page.getByRole("button", { name: "Review listing" }).click();
  for (let index = 0; index < 7; index++) {
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest("dialog"))), true);
  }
  await page.keyboard.press("Escape");
  assert.equal(server.receipts.size, beforeReview);
  assert.match(await page.evaluate(() => document.activeElement.textContent), /Review listing/);
  record("Review dialogs trap keyboard focus, restore focus on Escape and never auto-submit");

  await page.getByRole("button", { name: "Review listing" }).click();
  await page.getByRole("button", { name: "Confirm listing", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "hidden", timeout: 60000 });
  await notice("Your position is listed");
  const sellerListings = await server.market.view("get_listings_by_seller", { seller_id: alice, from_index: 0, limit: 100 });
  const sale = sellerListings[0];
  assert.equal((await getPosition("1")).owner_id, server.market.accountId);
  assert.equal(await tokenBalance(server.vault.accountId), originalVaultBalance);
  assert.equal(sale.unlock_at, original.unlock_at);
  record("Seller lists an existing payout NFT without moving its principal or maturity");

  await choose("Bob");
  await route("/sell");
  await page.getByLabel("Position ID", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Check position", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".import-panel .form-error")?.textContent.includes("does not own"));
  assert.equal((await getPosition("1")).owner_id, server.market.accountId);
  record("Import rejects a payout right the connected wallet does not own");

  await route("/position/" + sale.id);
  await page.getByRole("button", { name: "Review purchase", exact: true }).waitFor();
  await screenshot("position-desktop");
  const beforePurchaseReview = server.receipts.size;
  await page.getByRole("button", { name: "Review purchase", exact: true }).click();
  assert.match(await page.locator("dialog").textContent(), /8\.70%/);
  await page.keyboard.press("Escape");
  assert.equal(server.receipts.size, beforePurchaseReview);
  await page.getByRole("button", { name: "Review purchase", exact: true }).click();
  await page.getByRole("button", { name: /Confirm purchase/ }).evaluate(button => { button.click(); button.click(); });
  await page.locator("dialog").waitFor({ state: "hidden", timeout: 60000 });
  await notice("Position purchased");
  const bought = await getPosition("1");
  assert.equal(bought.owner_id, bob);
  assert.equal(bought.principal, original.principal);
  assert.equal(bought.unlock_at, original.unlock_at);
  assert.equal((await ledger(alice)).proceeds, "920000000");
  assert.equal((await ledger(bob)).available, "0");
  assert.equal(await tokenBalance(bob), "80000000");
  assert.equal(await tokenBalance(server.vault.accountId), originalVaultBalance);
  assert.equal(txCount("buy"), 1);
  record("A double press creates one purchase, delivers the original NFT and credits seller proceeds");

  await choose("Alice");
  await portfolio();
  await page.getByRole("button", { name: "Withdraw proceeds", exact: true }).click();
  await page.getByRole("button", { name: "Confirm withdrawal", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "hidden", timeout: 60000 });
  await notice("Sale proceeds arrived");
  const aliceAfterSale = aliceBeforeBorrow - 13000000n + 920000000n;
  assert.equal(BigInt(await tokenBalance(alice)), aliceAfterSale);
  assert.equal((await ledger(alice)).proceeds, "0");
  record("Seller withdraws the agreed 920 TUSD early-exit payment");

  await choose("Bob");
  await portfolio();
  assert.equal(await page.locator('[data-position-id="1"]').getByRole("button", { name: "Claim payout" }).count(), 0);
  const beforeTime = (await server.vault.view("get_config", {})).timestamp;
  await server.worker.provider.fastForward(600);
  const afterTime = (await server.vault.view("get_config", {})).timestamp;
  report.maturity = { method: "Sandbox fastForward(600); source maturity unchanged", beforeTime, afterTime, originalUnlockAt: original.unlock_at };
  await page.getByRole("button", { name: "Refresh positions" }).click();
  await page.locator('[data-position-id="1"]').getByRole("button", { name: "Claim payout" }).waitFor({ state: "visible" });
  await page.locator('[data-position-id="1"]').getByRole("button", { name: "Claim payout" }).click();
  await page.getByRole("button", { name: "Confirm maturity claim", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "hidden", timeout: 60000 });
  await notice("The full maturity payout arrived");
  assert.equal(await tokenBalance(bob), "1080000000");
  assert.equal((await getPosition("1")).status, "Redeemed");
  assert.equal((await getPosition("1")).unlock_at, original.unlock_at);
  assert.equal(BigInt(await tokenBalance(server.vault.accountId)), BigInt(originalVaultBalance) - BigInt(original.principal));
  const beforeReload = server.receipts.size;
  await page.reload();
  await page.locator('[data-position-id="1"]').waitFor();
  assert.equal(server.receipts.size, beforeReload);
  assert.equal(await page.locator('[data-position-id="1"]').getByRole("button", { name: "Claim payout" }).count(), 0);
  record("Buyer claims 1000 TUSD only after original maturity; reload neither reclaims nor replays");

  await choose("Alice");
  await portfolio();
  await page.getByRole("button", { name: "Get test tokens", exact: true }).click();
  await notice("Test tokens added");
  assert.equal(BigInt(await tokenBalance(alice)), aliceAfterSale + 1000000000n);
  await page.getByRole("button", { name: "Create test position", exact: true }).click();
  await page.getByLabel("Test principal", { exact: true }).fill("10");
  await page.getByLabel("Lock term").selectOption("604800");
  await page.locator("dialog").getByRole("button", { name: "Create test position", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "hidden", timeout: 60000 });
  await notice("Test position created");
  const newPosition = (await server.vault.view("get_positions_by_owner", { owner_id: alice, from_index: "0", limit: 100 })).find(position => position.status === "Active");
  assert.ok(newPosition);
  assert.equal(newPosition.principal, "10000000");
  await page.locator('[data-position-id="' + newPosition.token_id + '"]').getByRole("button", { name: "List position" }).click();
  await page.getByLabel("Sale price").fill("9");
  await page.getByRole("button", { name: "Review listing", exact: true }).click();
  await page.getByRole("button", { name: "Confirm listing", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "hidden", timeout: 60000 });
  await notice("Your position is listed");
  const race = (await server.market.view("get_listings_by_seller", { seller_id: alice, from_index: 0, limit: 100 })).find(listing => listing.status === "Open");
  record("The UI faucet and separate reference vault create a real listable test payout right");

  await choose("Bob");
  await route("/position/" + race.id);
  await page.getByRole("button", { name: "Review purchase", exact: true }).waitFor();
  let raced = false;
  await page.route("**/api/demo/transaction", async handler => {
    const payload = handler.request().postDataJSON();
    if (!raced && payload.methodName === "buy" && payload.args.listing_id === race.id) {
      raced = true;
      const cancelled = await server.send(server.accounts.alice, server.market, "cancel_listing", { listing_id: race.id }, OPERATION_STORAGE);
      assert.equal(cancelled.parseResult(), true);
    }
    await handler.continue();
  });
  await page.getByRole("button", { name: "Review purchase", exact: true }).click();
  await page.getByRole("button", { name: /Confirm purchase/ }).click();
  await page.locator("dialog").getByRole("alert").waitFor({ state: "visible", timeout: 60000 });
  assert.match(await page.locator("dialog").getByRole("alert").textContent(), /transaction failed/);
  await page.waitForFunction(() => !document.querySelector("dialog .icon-button")?.disabled);
  await page.keyboard.press("Escape");
  await page.unroute("**/api/demo/transaction");
  assert.equal(raced, true);
  assert.equal((await ledger(bob)).available, "9000000");
  assert.equal((await getPosition(newPosition.token_id)).owner_id, alice);
  await portfolio();
  await page.getByRole("button", { name: "Return to wallet", exact: true }).click();
  await page.getByRole("button", { name: "Confirm withdrawal", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "hidden", timeout: 60000 });
  await notice("Unused market funds returned");
  assert.equal((await ledger(bob)).available, "0");
  assert.equal(await tokenBalance(bob), "1080000000");
  record("A real cancellation between funding and buy leaves a recoverable balance; UI withdraws it");

  await route("/activity");
  await page.locator(".activity-row").first().waitFor();
  const failedBuy = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith("lockpad-journal:"));
    return JSON.parse(localStorage.getItem(key)).find(item => item.request.methodName === "buy" && item.state === "Review receipt");
  });
  assert.ok(failedBuy?.hash);
  const failedReceipt = server.receipts.get(failedBuy.hash);
  assert.ok(failedReceipt.status.Failure);
  const beforeReceiptReview = server.receipts.size;
  await page.getByRole("button", { name: "Check receipt", exact: true }).click();
  await notice("The transaction failed");
  assert.equal(server.receipts.size, beforeReceiptReview);
  assert.ok(JSON.parse(await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith("lockpad-journal:"));
    return localStorage.getItem(key);
  })).some(item => item.id === failedBuy.id && item.state === "Review receipt"));
  record("A failed action keeps its own receipt; checking it never replays a transaction");
  await page.getByRole("button", { name: "Dismiss notification", exact: true }).click();

  const accounting = await server.market.view("get_accounting", {});
  const liabilities = ["available", "proceeds", "reserved_purchases", "pending_withdrawals"].reduce((sum, key) => sum + BigInt(accounting[key]), 0n);
  assert.equal(BigInt(await tokenBalance(server.market.accountId)), liabilities);
  report.accounting = accounting;
  report.trade = { original, purchased: bought, redeemed: await getPosition("1"), sellerPayment: "920000000", buyerPayout: "1000000000", saleListing: sale.id };
  record("Marketplace token holdings exactly cover all remaining payment liabilities");

  const layouts = [];
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width > 700 ? 1000 : 844 });
    for (const path of ["/", "/borrow", "/marketplace", "/positions", "/sell", "/activity", "/sources", "/position/" + sale.id]) {
      await route(path);
      if (path.startsWith("/position/")) await page.locator(".purchase-panel").waitFor();
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
      assert.ok(layout.content <= layout.viewport + 1, "Horizontal overflow at " + width + " " + path);
      if (path === "/") {
        const hero = await page.evaluate(() => {
          const copy = document.querySelector(".hero-copy").getBoundingClientRect();
          const comparison = document.querySelector(".hero-comparison").getBoundingClientRect();
          return { overlapWidth: Math.min(copy.right, comparison.right) - Math.max(copy.left, comparison.left), overlapHeight: Math.min(copy.bottom, comparison.bottom) - Math.max(copy.top, comparison.top) };
        });
        assert.ok(hero.overlapWidth <= 0 || hero.overlapHeight <= 0, "The hero text covers its borrowing/sale comparison at " + width);
        layout.heroContentSeparate = true;
      }
      layouts.push({ width, path, ...layout });
      if (path === "/" && width !== 1440) await screenshot("home-" + width);
      if (width === 390 && ["/borrow", "/marketplace", "/positions", "/sell", "/activity", "/position/" + sale.id].includes(path)) await screenshot(path.startsWith("/position/") ? "position-mobile" : path.slice(1) + "-mobile");
    }
  }
  report.layouts = layouts;
  record("Eight app routes fit desktop, tablet, 390px and 320px; hero copy and comparison never overlap");

  await page.setViewportSize({ width: 390, height: 844 });
  await route("/");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  assert.equal(await page.locator(".main-nav").isVisible(), true);
  await page.locator(".main-nav").getByRole("link", { name: "Marketplace", exact: true }).click();
  assert.equal(await page.locator(".main-nav").isVisible(), false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".position-card").first().hover();
  assert.equal(await page.locator(".position-card").first().evaluate(element => getComputedStyle(element).transform), "none");
  record("Mobile navigation closes on selection and reduced motion removes card movement");

  publicServer = await startPublicPreview();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(publicServer.url);
  await page.getByRole("heading", { name: /Locked position/ }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".skeleton-card"));
  assert.equal(await page.locator(".position-card").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Connect wallet", exact: true }).isDisabled(), true);
  await page.locator(".hero-actions").getByRole("link", { name: /Explore the marketplace/ }).click();
  await page.getByRole("heading", { name: "No available positions", exact: true }).waitFor();
  assert.equal(await page.locator(".position-card").count(), 0);
  assert.equal(await page.evaluate(() => document.fonts.check("12px Manrope")), true);
  record("Production build works under /timeshift/ and offers no fabricated or unconfigured trades");

  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  report.status = "PASS";
  report.executedAt = new Date().toISOString();
  report.contractBuild = JSON.parse(await readFile(join(evidence, "contract-build.json"), "utf8"));
  report.sources = {};
  for (const file of ["src/app.jsx", "src/style.css", "src/theme.css", "src/borrow.jsx", "src/components/interface.jsx", "src/hooks/use-lockpad.js", "src/lib/chain.mjs", "src/lib/amounts.mjs", "src/lib/market.mjs", "src/lib/lending.mjs", "scripts/demo-server.mjs", "scripts/sandbox.mjs", "scripts/browser-test.mjs", "vite.config.js", "index.html"]) report.sources[file] = createHash("sha256").update(await readFile(join(project, file))).digest("hex");
  await writeFile(join(evidence, "browser-receipts.json"), JSON.stringify({ network: report.network, accounts: report.accounts, recordedAt: report.executedAt, receipts: [...server.receipts.values()] }, null, 2) + "\n");
  console.log("PASS:", checks.length, "browser behavior checks; screenshots and local receipts saved.");
} catch (error) {
  report.status = "FAIL";
  report.error = error.stack || error.message;
  if (page && !page.isClosed()) try { await screenshot("browser-failure"); } catch {}
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(join(evidence, "browser-tests.json"), JSON.stringify(report, null, 2) + "\n");
  if (browser) await browser.close();
  if (publicServer) await publicServer.close();
  if (server) await server.close();
}
