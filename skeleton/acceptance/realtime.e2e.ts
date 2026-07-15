/**
 * Realtime SSE acceptance test: Wave B — ADR-0006 dogfood
 *
 * Test: Two concurrent browser contexts (both admin)
 * - Context A: navigate to /invoices and wait
 * - Context B: create an invoice via form
 * - Assert: new invoice appears in A WITHOUT reload (SSE + query invalidation)
 *
 * Falsifiability proof: disabling invalidateQueries in useRealtime.ts should fail this test
 */

import { expect, test, type Page } from "@playwright/test";

const runId = String(Date.now()).slice(-6);

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

/**
 * Fill the create invoice form's required fields.
 */
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

test.describe("realtime: SSE + query invalidation", () => {
  test("invoice creation updates list in concurrent browser (no reload needed)", async ({ browser }) => {
    // Context A: observer (watches invoice list)
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await loginAs(pageA, "admin@dev.local", "dev-admin-password");
    await pageA.goto("/invoices");
    await expect(pageA.locator('table, [data-testid="invoices-table"]')).toBeVisible();
    // Wait for table to have at least one row (indicates initial data loaded)
    await expect(pageA.locator("tbody tr").first()).toBeVisible();
    // Give SSE connection time to establish (EventSource opens asynchronously in useRealtime)
    await new Promise(r => setTimeout(r, 1000));

    // Context B: creator (creates invoice via form)
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await loginAs(pageB, "admin@dev.local", "dev-admin-password");
    await pageB.goto("/invoices/create");
    await expect(pageB.locator('input[data-testid="customer-name-input"]')).toBeVisible();

    // Get initial invoice count in context A
    const getRowCount = async () => {
      // Count only data rows: the empty state ("No invoices found") is also a
      // tbody tr, which would make an empty list count as 1.
      return pageA.locator('tr[data-testid*="invoice-row"]').count();
    };
    const initialCount = await getRowCount();

    // Create invoice in context B
    const invoiceCustomer = `RTZ-${runId}`;
    const invoiceNumber = `INV-2${runId}`;
    await fillInvoiceForm(pageB, {
      customer: invoiceCustomer,
      number: invoiceNumber,
      description: "realtime test item",
      qty: "1",
      price: "100",
    });
    await pageB.locator('button[data-testid="submit-invoice-btn"]').first().click();

    // Wait for success feedback (URL navigation)
    await pageB.waitForURL("**/invoices");

    // Assert: new invoice appears in context A WITHOUT reload
    // Realtime SSE should trigger query invalidation → automatic refetch
    const newRowLocator = pageA.locator(`text=${invoiceCustomer}`);
    await expect(newRowLocator).toBeVisible({ timeout: 20000 });

    const finalCount = await getRowCount();
    expect(finalCount).toBe(initialCount + 1);

    // Verify the new row is visible without manual reload
    await expect(
      pageA.locator("td", { hasText: invoiceNumber })
    ).toBeVisible();

    await contextA.close();
    await contextB.close();
  });
});
