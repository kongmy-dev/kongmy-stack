/**
 * Browser smoke test: catches integration bugs that unit tests miss.
 *
 * Catches:
 * - Missing CSS import in main.tsx (app renders unstyled)
 * - TanStack router tree misconfiguration (routes 404)
 * - Form validation not wired (422 doesn't land on field)
 * - API proxy misconfiguration
 * - locale switching broken
 *
 * Runs against real Hono app (PGlite in-memory) + real Vite dev server.
 */

import { expect, test, type Page } from "@playwright/test";

const runId = String(Date.now()).slice(-6);

/** Fill the create form's required fields (email included — the contract requires it). */
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

test.describe("acceptance smoke", () => {
  test("app loads with styles applied (catches missing CSS import)", async ({ page }) => {
    // Navigate to invoices list
    await page.goto("/invoices");
    await page.waitForLoadState("networkidle");

    // Find a button that should have Tailwind styling
    const createButton = page.locator('button[data-testid="create-invoice-btn"]').first();
    await expect(createButton).toBeVisible();

    // Two-part check, both falsifiable (proven by commenting out the CSS import):
    // 1. The sapphire theme's custom property must exist on :root — it is empty
    //    when the stylesheet never loads. (Do NOT assert exact colors — brittle.)
    // 2. The button must not wear the UA default (ButtonFace) — note a plain
    //    "not transparent" check can NEVER fail for <button> elements.
    const themeToken = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim()
    );
    expect(themeToken).not.toBe("");

    const bgColor = await createButton.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });
    expect(bgColor).not.toBe("rgb(239, 239, 239)"); // ButtonFace = stylesheet missing
  });

  test("navigate to /invoices/create via button click (catches router tree issues)", async ({
    page,
  }) => {
    await page.goto("/invoices");
    await page.waitForLoadState("networkidle");

    // Click the create button
    const createButton = page.locator('button[data-testid="create-invoice-btn"]').first();
    await createButton.click();
    await page.waitForLoadState("networkidle");

    // Should be on /invoices/create with the form visible
    expect(page.url()).toContain("/invoices/create");
    const form = page.locator('form[data-testid="invoice-form"]').first();
    await expect(form).toBeVisible();
  });

  test("fill form and submit creates invoice (end-to-end CRUD)", async ({ page }) => {
    await page.goto("/invoices/create");
    await page.waitForLoadState("networkidle");

    await fillInvoiceForm(page, {
      customer: `ACME Corp ${runId}`,
      number: `INV-2026-1${runId}`,
      description: "Consulting services",
      qty: "1",
      price: "1000",
    });

    await page.locator('button[data-testid="submit-invoice-btn"]').first().click();

    // Should land on /invoices with the new row visible
    const rows = page.locator('tr[data-testid*="invoice-row"]');
    await expect(rows.filter({ hasText: `ACME Corp ${runId}` })).toHaveCount(1, { timeout: 10_000 });
    expect(page.url()).toContain("/invoices");
  });

  test("form validation: empty line items shows error on correct field", async ({ page }) => {
    await page.goto("/invoices/create");
    await page.waitForLoadState("networkidle");

    await fillInvoiceForm(page, {
      customer: `Test Corp ${runId}`,
      number: `INV-2026-9${runId}`,
      description: "temp",
      qty: "1",
      price: "100",
    });

    // Remove the only line item so the API's validator rejects the payload
    await page.getByRole("button", { name: "Remove Line Item" }).first().click();

    await page.locator('button[data-testid="submit-invoice-btn"]').first().click();

    // Seam 6: 422 → form.setError → field-level error rendered; still on create page
    const lineItemsError = page.locator('[data-testid="lineItems-error"]').first();
    await expect(lineItemsError).toBeVisible({ timeout: 10_000 });
    expect(page.url()).toContain("/invoices/create");
  });

  test("edit invoice and verify update", async ({ page }) => {
    // First create an invoice
    await page.goto("/invoices/create");
    await page.waitForLoadState("networkidle");

    await fillInvoiceForm(page, {
      customer: `Edit Test Corp ${runId}`,
      number: `INV-2026-7${runId}`,
      description: "Edit test item",
      qty: "2",
      price: "500",
    });
    await page.locator('button[data-testid="submit-invoice-btn"]').first().click();
    await page.waitForLoadState("networkidle");

    // Now edit: find the created row and click its edit button
    const createdRow = page
      .locator('tr[data-testid*="invoice-row"]')
      .filter({ hasText: `Edit Test Corp ${runId}` })
      .first();
    await expect(createdRow).toBeVisible({ timeout: 10_000 });
    await createdRow.locator('button[data-testid*="edit-invoice"]').click();
    await page.waitForLoadState("networkidle");

    // Should be on /invoices/{id}/edit
    expect(page.url()).toContain("/invoices/");
    expect(page.url()).toContain("/edit");

    // Update customer name
    const editCustomerInput = page.locator('input[data-testid="customer-name-input"]').first();
    const currentValue = await editCustomerInput.inputValue();
    await editCustomerInput.clear();
    await editCustomerInput.fill(`Edit Test Corp ${runId} UPDATED`);

    // Save
    const saveBtn = page.locator('button[data-testid="submit-invoice-btn"]').first();
    await saveBtn.click();
    await page.waitForLoadState("networkidle");

    // Verify we're back on list and the updated name is visible
    expect(page.url()).toContain("/invoices");
    const updatedRow = page.locator("table").locator(`text=Edit Test Corp ${runId} UPDATED`);
    await expect(updatedRow).toBeVisible();
  });

  test("delete invoice and verify removal", async ({ page }) => {
    // First create an invoice
    await page.goto("/invoices/create");
    await page.waitForLoadState("networkidle");

    await fillInvoiceForm(page, {
      customer: `Delete Test Corp ${runId}`,
      number: `INV-2026-8${runId}`,
      description: "Delete test",
      qty: "1",
      price: "250",
    });
    await page.locator('button[data-testid="submit-invoice-btn"]').first().click();

    const targetRow = page
      .locator('tr[data-testid*="invoice-row"]')
      .filter({ hasText: `Delete Test Corp ${runId}` })
      .first();
    await expect(targetRow).toBeVisible({ timeout: 10_000 });

    // The delete flow uses a native confirm() dialog — accept it
    page.on("dialog", (dialog) => dialog.accept());
    await targetRow.locator('button[data-testid*="delete-invoice"]').click();

    // Row should be gone
    await expect(
      page.locator('tr[data-testid*="invoice-row"]').filter({ hasText: `Delete Test Corp ${runId}` })
    ).toHaveCount(0, { timeout: 10_000 });
  });

  test("locale switch EN ↔ MS shows translated strings", async ({ page }) => {
    await page.goto("/invoices");
    await page.waitForLoadState("networkidle");

    // Get a heading that should have a translation
    const heading = page.locator('h1[data-testid="page-title"]').first();
    const enText = await heading.textContent();
    expect(enText).toBeTruthy();

    // Switch locale to MS (the toggle is a <select>)
    await page.locator('[data-testid="locale-toggle"]').first().selectOption("ms");
    await page.waitForTimeout(500); // Wait for re-render

    // Get the heading text in MS
    const msText = await heading.textContent();

    // They should be different (EN vs MS)
    expect(msText).not.toEqual(enText);
  });
});
