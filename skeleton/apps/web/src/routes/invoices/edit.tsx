/**
 * Edit invoice route — Loads existing invoice and allows update
 *
 * Similar to create, but:
 * - Fetches invoice data from API (seam 2: queryOptions)
 * - Uses invoiceUpdateInput schema (subset of create fields)
 * - Updates existing record instead of creating
 */

import { useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { invoiceUpdateInput, type InvoiceUpdateInput } from "@kongmy-stack/contract";
import type { z } from "zod";

type InvoiceUpdateFormInput = z.input<typeof invoiceUpdateInput>;
import { parseApiError } from "../../lib/errorMapper";
import { invoiceQueries, invoiceMutations } from "../../lib/queryOptions";
import { useState } from "react";

// Placeholder messages - will be replaced by Paraglide at build time
import * as m from "../../paraglide/messages.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Extract the ID from the window location
function getInvoiceIdFromUrl(): string {
  const match = window.location.pathname.match(/\/invoices\/([^/]+)\/edit/);
  return match ? match[1] : "";
}

export default function EditInvoicePage() {
  const invoiceId = getInvoiceIdFromUrl();
  if (!invoiceId) {
    throw new Error("Invoice ID not found in URL");
  }
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Query: Fetch the invoice (seam 2)
  const { data: invoice } = useSuspenseQuery(invoiceQueries.detail(invoiceId));

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<InvoiceUpdateFormInput, unknown, InvoiceUpdateInput>({
    resolver: zodResolver(invoiceUpdateInput),
    defaultValues: {
      customerName: (invoice as any)?.customerName || "",
      customerEmail: (invoice as any)?.customerEmail || "",
      issuedDate: (invoice as any)?.issuedDate || "",
      dueDate: (invoice as any)?.dueDate || "",
      notes: (invoice as any)?.notes || "",
    },
  });

  // Mutation: Update invoice
  const updateMutation = useMutation({
    ...invoiceMutations.update(),
    onSuccess: async () => {
      setToastMessage(m.invoices_update_success());
      // Invalidate detail and list
      await queryClient.invalidateQueries({
        queryKey: ["invoices", invoiceId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["invoices"],
      });
      // Navigate back after delay
      setTimeout(() => {
        navigate({ to: "/invoices/" });
      }, 1000);
    },
    onError: (err) => {
      const { toastMessage: msg, formErrors } = parseApiError(err);
      if (msg) {
        setToastMessage(msg);
      }
      if (formErrors) {
        Object.entries(formErrors).forEach(([field, message]) => {
          setError(field as keyof InvoiceUpdateFormInput, {
            type: "server",
            message,
          });
        });
      }
    },
  });

  const onSubmit = async (data: InvoiceUpdateInput) => {
    updateMutation.mutate({ id: invoiceId, data });
  };

  return (
    <div className="max-w-2xl mx-auto">
      {toastMessage && (
        <div className="mb-4 rounded bg-blue-50 p-4 text-sm text-blue-800">
          {toastMessage}
        </div>
      )}

      <h1 className="mb-6 text-3xl font-bold" data-testid="page-title">{m.invoices_edit_title()}</h1>

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
            />
            {errors.customerEmail && (
              <p className="mt-1 text-sm text-red-600">
                {errors.customerEmail.message}
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
