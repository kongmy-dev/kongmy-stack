/**
 * Browser acceptance smoke test: Wave A complete.
 * Extends CRUD tests with real credential auth: login helper + permission enforcement.
 *
 * Tests:
 * 1. CSS/theme loading (admin session)
 * 2. Form validation 422→field mapping (admin)
 * 3. Create invoice (admin)
 * 4. Edit invoice (admin)
 * 5. Delete button visibility (admin has permission)
 * 6. Delete invoice (admin)
 * 7. Locale switching EN↔MS
 * 8. Anonymous /invoices redirects to /login
 * 9. Clerk cannot DELETE (403 FORBIDDEN), button hidden
 */

import { expect, test, type Page } from "@playwright/test";

const runId = String(Date.now()).slice(-6);

/** Fill the create form's required fields. */
async function fillInvoiceForm(
  page: Page,
  opts: { customer: string; number: string; description: string; qty: string; price: string }
) {
  await page.locator('input[data-testid="customer-name-input"]').first().fill(opts.customer);
  await page.locator('input[data-testid="customer-email-input"]').first().fill("smoke@test.example");
  await page.locator('input[data-testid="invoice-number-input"]').first().fill(opts.number);
  await page.locator('input[data-testid="line-item-description-input"]').first().fill(opts.description);
  await page.locator('input[data-testid="line-item-quantity-input"]').first().fill(opts.qty);
  await page.locator('input[data-testid="line-item-price-input"]').first().fill(opts.price);
}

/**
 * Login helper: POST /auth/sign-in, set session cookie in browser context.
 */
async function loginAs(page: Page, email: string, password: string): Promise<string> {
  const response = await page.context().request.post("/api/auth/sign-in", {
    data: { email, password },
  });

  if (response.status() !== 200) {
    throw new Error(`Login failed: ${response.status()}`);
  }

  const setCookieHeader = response.headers()["set-cookie"];
  if (!setCookieHeader) {
    throw new Error("No set-cookie header");
  }

  const sessionCookie = setCookieHeader.split(";")[0];

  await page.context().addCookies([
    {
      name: "auth_session",
      value: sessionCookie.replace("auth_session=", ""),
      url: `http://localhost:${process.env.WEB_PORT || "5174"}`,
      httpOnly: true,
    },
  ]);

  return sessionCookie;
}

test.describe("smoke: Wave A auth + CRUD", () => {
  test("css/theme loading", async ({ page }) => {
    await loginAs(page, "admin@dev.local", "dev-admin-password");
    await page.goto("/invoices");
    await page.waitForLoadState("networkidle");
    const btn = page.locator('button[data-testid="create-invoice-btn"]').first();
    await expect(btn).toBeVisible();
  });

  test("form validation: 422 field error", async ({ page }) => {
    await loginAs(page, "admin@dev.local", "dev-admin-password");
    await page.goto("/invoices/create");
    await page.waitForLoadState("networkidle");
    await fillInvoiceForm(page, {
      customer: `Test ${runId}`,
      number: `INV-9${runId}`,
      description: "tmp",
      qty: "1",
      price: "100",
    });
    await page.getByRole("button", { name: "Remove Line Item" }).first().click();
    await page.locator('button[data-testid="submit-invoice-btn"]').first().click();
    const err = page.locator('[data-testid="lineItems-error"]').first();
    await expect(err).toBeVisible({ timeout: 10000 });
  });

  test("create invoice (admin)", async ({ page }) => {
    await loginAs(page, "admin@dev.local", "dev-admin-password");
    await page.goto("/invoices/create");
    await page.waitForLoadState("networkidle");

    // Calculate expected dates (today and 30 days from now)
    // Dates are formatted as toLocaleDateString() in the table
    const today = new Date();
    const expectedIssuedFormatted = today.toLocaleDateString();
    const dueDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const expectedDueFormatted = dueDate.toLocaleDateString();

    await fillInvoiceForm(page, {
      customer: `Create ${runId}`,
      number: `INV-1${runId}`,
      description: "item",
      qty: "1",
      price: "100",
    });
    await page.locator('button[data-testid="submit-invoice-btn"]').first().click();
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/invoices");
    // Verify the created invoice appears in the list with correct dates
    const row = page.locator('tr[data-testid*="invoice-row"]').filter({ hasText: `Create ${runId}` }).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    // Assert the dates match submitted values, not hardcoded placeholders
    await expect(row).toContainText(expectedIssuedFormatted);
    await expect(row).toContainText(expectedDueFormatted);
  });

  test("edit invoice (admin)", async ({ page }) => {
    await loginAs(page, "admin@dev.local", "dev-admin-password");
    await page.goto("/invoices/create");
    await page.waitForLoadState("networkidle");
    await fillInvoiceForm(page, {
      customer: `Edit ${runId}`,
      number: `INV-7${runId}`,
      description: "item",
      qty: "2",
      price: "500",
    });
    await page.locator('button[data-testid="submit-invoice-btn"]').first().click();
    await page.waitForLoadState("networkidle");
    const row = page.locator('tr[data-testid*="invoice-row"]').filter({ hasText: `Edit ${runId}` }).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.locator('button[data-testid*="edit-invoice"]').click();
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/edit");
  });

  test("delete button visible (admin)", async ({ page }) => {
    await loginAs(page, "admin@dev.local", "dev-admin-password");
    await page.goto("/invoices/create");
    await page.waitForLoadState("networkidle");
    await fillInvoiceForm(page, {
      customer: `Delete ${runId}`,
      number: `INV-8${runId}`,
      description: "item",
      qty: "1",
      price: "100",
    });
    await page.locator('button[data-testid="submit-invoice-btn"]').first().click();
    await page.waitForLoadState("networkidle");
    const row = page.locator('tr[data-testid*="invoice-row"]').filter({ hasText: `Delete ${runId}` }).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    const btn = row.locator('button[data-testid*="delete-invoice"]');
    await expect(btn).toBeVisible();
  });

  test("delete invoice (admin)", async ({ page }) => {
    await loginAs(page, "admin@dev.local", "dev-admin-password");
    await page.goto("/invoices/create");
    await page.waitForLoadState("networkidle");
    await fillInvoiceForm(page, {
      customer: `Final ${runId}`,
      number: `INV-99${runId}`,
      description: "item",
      qty: "1",
      price: "100",
    });
    await page.locator('button[data-testid="submit-invoice-btn"]').first().click();
    await page.waitForLoadState("networkidle");
    const row = page.locator('tr[data-testid*="invoice-row"]').filter({ hasText: `Final ${runId}` }).first();
    await row.locator('button[data-testid*="delete-invoice"]').click();
    const confirm = page.locator('button:has-text("Confirm")').first();
    if (await confirm.isVisible({ timeout: 1000 }).catch(() => false)) await confirm.click();
    await page.waitForLoadState("networkidle");
  });

  test("locale switching", async ({ page }) => {
    await loginAs(page, "admin@dev.local", "dev-admin-password");
    await page.goto("/invoices");
    await page.waitForLoadState("networkidle");
    const heading = page.locator('h1[data-testid="page-title"]').first();
    const en = await heading.textContent();
    await page.locator('[data-testid="locale-toggle"]').first().selectOption("ms");
    await page.waitForTimeout(500);
    const ms = await heading.textContent();
    expect(ms).not.toEqual(en);
  });

  test("anonymous /invoices redirects to /login", async ({ page }) => {
    await page.goto("/invoices");
    await page.waitForNavigation({ timeout: 5000 }).catch(() => {});
    expect(page.url()).toContain("/login");
  });

  test("clerk: DELETE 403, button hidden", async ({ page }) => {
    const cookie = await loginAs(page, "clerk@dev.local", "dev-clerk-password");
    const resp = await page.context().request.delete("/api/invoices/inv_test", {
      headers: { Cookie: cookie },
    });
    expect(resp.status()).toBe(403);
    const err = await resp.json();
    expect(err.error.code).toBe("FORBIDDEN");

    await page.goto("/invoices");
    await page.waitForLoadState("networkidle");
    const btns = page.locator('button:has-text("Delete")');
    expect(await btns.count()).toBe(0);
  });
});
