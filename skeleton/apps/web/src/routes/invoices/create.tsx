/**
 * Create invoice route — Seam 4+6: Form with zodResolver + error mapping
 *
 * Demonstrates:
 * - zodResolver(invoiceCreateInput) for form validation
 * - Error envelope parsing and field-level error mapping (seam 6)
 * - All UI strings through Paraglide messages (seam 9)
 */

import { useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoiceCreateInput, type InvoiceCreateInput } from "@kongmy-stack/contract";
import type { z } from "zod";
import { apiClient } from "../../lib/api";
import { parseApiError } from "../../lib/errorMapper";
import { useState } from "react";

// zodResolver v5 types the form by the schema INPUT (unbranded); onSubmit receives the parsed OUTPUT
type InvoiceCreateFormInput = z.input<typeof invoiceCreateInput>;

// Placeholder messages - will be replaced by Paraglide at build time
import * as m from "../../paraglide/messages.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function CreateInvoicePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lineItems, setLineItems] = useState([
    {
      lineNo: 1,
      description: "",
      quantity: 1,
      unitOfMeasure: "PCS" as const,
      unitPrice: 0,
      taxRateBps: 600, // 6%
      lineTotal: 0,
      lineTaxAmount: 0,
    },
  ]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    setValue,
  } = useForm<InvoiceCreateFormInput, unknown, InvoiceCreateInput>({
    resolver: zodResolver(invoiceCreateInput),
    defaultValues: {
      customerId: "cust_01HZXA0000000000000000001A",
      customerName: "",
      customerEmail: "",
      number: "",
      issuedDate: new Date().toISOString().split("T")[0],
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      currency: "MYR",
      lineItems: lineItems,
      subtotal: 0,
      totalTax: 0,
      total: 0,
      notes: "",
    },
  });

  // Mutation: Create invoice
  const createMutation = useMutation({
    mutationFn: async (data: InvoiceCreateInput) => {
      return apiClient.invoices.create(data as Record<string, unknown>);
    },
    onSuccess: async () => {
      setToastMessage(m.invoices_create_success());
      // Invalidate list
      await queryClient.invalidateQueries({
        queryKey: ["invoices"],
      });
      // Navigate back to list after a brief delay
      setTimeout(() => {
        navigate({ to: "/invoices" });
      }, 1000);
    },
    onError: (err) => {
      const { toastMessage: msg, formErrors } = parseApiError(err);
      if (msg) {
        setToastMessage(msg);
      }
      // Set field-level errors
      if (formErrors) {
        Object.entries(formErrors).forEach(([field, message]) => {
          setError(field as keyof InvoiceCreateFormInput, {
            type: "server",
            message,
          });
        });
      }
    },
  });

  const onSubmit = async (data: InvoiceCreateInput) => {
    // Derive money fields from line items (int minor units, ADR-0009)
    const items = data.lineItems.map((li) => {
      const lineTotal = Math.round(li.quantity * li.unitPrice);
      const lineTaxAmount = Math.round((lineTotal * li.taxRateBps) / 10_000);
      return { ...li, lineTotal, lineTaxAmount };
    });
    const subtotal = items.reduce((s, li) => s + li.lineTotal, 0);
    const totalTax = items.reduce((s, li) => s + li.lineTaxAmount, 0);
    createMutation.mutate({
      ...data,
      lineItems: items,
      subtotal,
      totalTax,
      total: subtotal + totalTax,
    });
  };

  /** Keep RHF form state in sync with the local line-items UI state. */
  const syncLineItems = (updated: typeof lineItems) => {
    setLineItems(updated);
    setValue("lineItems", updated as InvoiceCreateFormInput["lineItems"]);
  };

  const handleAddLineItem = () => {
    const newLineNo =
      (lineItems.length > 0
        ? Math.max(...lineItems.map((l) => l.lineNo))
        : 0) + 1;
    const newItem = {
      lineNo: newLineNo,
      description: "",
      quantity: 1,
      unitOfMeasure: "PCS" as const,
      unitPrice: 0,
      taxRateBps: 600,
      lineTotal: 0,
      lineTaxAmount: 0,
    };
    syncLineItems([...lineItems, newItem]);
  };

  const handleRemoveLineItem = (index: number) => {
    const updated = lineItems.filter((_, i) => i !== index);
    syncLineItems(updated);
  };

  return (
    <div className="max-w-2xl mx-auto">
      {toastMessage && (
        <div className="mb-4 rounded bg-blue-50 p-4 text-sm text-blue-800">
          {toastMessage}
        </div>
      )}

      <h1 className="mb-6 text-3xl font-bold" data-testid="page-title">{m.invoices_create_title()}</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" data-testid="invoice-form">
        {/* Customer Info */}
        <fieldset className="space-y-4 rounded border border-gray-200 p-4">
          <legend className="text-lg font-semibold">{m.common_search()}</legend>

          <div>
            <Label className="block text-sm font-medium text-gray-900">
              {m.invoices_customer_name()}
            </Label>
            <Input
              type="text"
              {...register("customerName")}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
              placeholder="Acme Corp"
              data-testid="customer-name-input"
            />
            {errors.customerName && (
              <p className="mt-1 text-sm text-red-600">
                {errors.customerName.message}
              </p>
            )}
          </div>

          <div>
            <Label className="block text-sm font-medium text-gray-900">
              {m.invoices_customer_email()}
            </Label>
            <Input
              type="email"
              {...register("customerEmail")}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
              placeholder="customer@example.com"
              data-testid="customer-email-input"
            />
            {errors.customerEmail && (
              <p className="mt-1 text-sm text-red-600">
                {errors.customerEmail.message}
              </p>
            )}
          </div>

          <div>
            <Label className="block text-sm font-medium text-gray-900">
              {m.invoices_number()}
            </Label>
            <Input
              type="text"
              {...register("number")}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
              placeholder="INV-001"
              data-testid="invoice-number-input"
            />
            {errors.number && (
              <p className="mt-1 text-sm text-red-600">
                {errors.number.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="block text-sm font-medium text-gray-900">
                {m.invoices_issued_date()}
              </Label>
              <Input
                type="date"
                {...register("issuedDate")}
                className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
              />
              {errors.issuedDate && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.issuedDate.message}
                </p>
              )}
            </div>

            <div>
              <Label className="block text-sm font-medium text-gray-900">
                {m.invoices_due_date()}
              </Label>
              <Input
                type="date"
                {...register("dueDate")}
                className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
              />
              {errors.dueDate && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.dueDate.message}
                </p>
              )}
            </div>
          </div>

          <div>
            <Label className="block text-sm font-medium text-gray-900">
              {m.invoices_currency()}
            </Label>
            <select
              {...register("currency")}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="MYR">MYR</option>
              <option value="USD">USD</option>
              <option value="SGD">SGD</option>
            </select>
          </div>
        </fieldset>

        {/* Line Items */}
        <fieldset className="space-y-4 rounded border border-gray-200 p-4">
          <legend className="text-lg font-semibold">
            {m.invoices_line_items()}
          </legend>

          {lineItems.map((item, index) => (
            <div key={index} className="space-y-2 rounded bg-gray-50 p-3">
              <div className="grid grid-cols-3 gap-2">
                <Input
                  type="text"
                  placeholder={m.invoices_description()}
                  value={item.description}
                  onChange={(e) => {
                    const updated = [...lineItems];
                    updated[index].description = e.target.value;
                    syncLineItems(updated);
                  }}
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                  data-testid="line-item-description-input"
                />
                <Input
                  type="number"
                  placeholder={m.invoices_quantity()}
                  value={item.quantity}
                  onChange={(e) => {
                    const updated = [...lineItems];
                    updated[index].quantity = Number(e.target.value) || 0;
                    syncLineItems(updated);
                  }}
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                  data-testid="line-item-quantity-input"
                />
                <Input
                  type="number"
                  placeholder={m.invoices_unit_price()}
                  value={item.unitPrice}
                  onChange={(e) => {
                    const updated = [...lineItems];
                    updated[index].unitPrice = Number(e.target.value) || 0;
                    syncLineItems(updated);
                  }}
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                  data-testid="line-item-price-input"
                />
              </div>
              <Button
                type="button"
                onClick={() => handleRemoveLineItem(index)}
                className="text-sm text-red-600 hover:text-red-700"
              >
                {m.invoices_remove_line_item()}
              </Button>
            </div>
          ))}

          <Button
            type="button"
            onClick={handleAddLineItem}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            {m.invoices_add_line_item()}
          </Button>
          {errors.lineItems && (
            <p className="mt-2 text-sm text-red-600" data-testid="lineItems-error">
              {errors.lineItems.message}
            </p>
          )}
        </fieldset>

        {/* Notes */}
        <div>
          <Label className="block text-sm font-medium text-gray-900">
            {m.invoices_notes()}
          </Label>
          <textarea
            {...register("notes")}
            rows={3}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            placeholder="Additional notes..."
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={isSubmitting}
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-gray-400"
            data-testid="submit-invoice-btn"
          >
            {isSubmitting ? m.common_loading() : m.common_save()}
          </Button>
          <Button
            type="button"
            onClick={() => navigate({ to: "/invoices/" })}
            className="rounded border border-gray-300 px-4 py-2 hover:bg-gray-50"
          >
            {m.common_cancel()}
          </Button>
        </div>
      </form>
    </div>
  );
}
