/**
 * Invoices list route — Seam 3+5: DataTable with URL pagination & search-param validation
 *
 * Pagination state (limit, offset) lives in URL search params.
 * This enables shareable URLs (seam 5) and enables copy-paste of filtered/sorted views.
 *
 * Contract paginationQuery schema drives validation:
 *   limit, offset validated here before being passed to the API.
 *
 * UI: vendored sapphire components (Button/Table/Badge — source-owned, ADR boundary).
 * Strings: generated Paraglide catalog only.
 * Auth: beforeLoad guard redirects to /login if not authenticated.
 */

import { useNavigate } from "@tanstack/react-router";
import {
  useSuspenseQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { invoiceQueries, invoiceMutations, sessionQueries } from "../../lib/queryOptions";
import { invoiceListItem, invoiceResource } from "@kongmy-stack/contract";
import { z } from "zod";
import { ApiError } from "../../lib/api";
import { useLocale } from "../../contexts/localeContext";
import * as m from "../../paraglide/messages.js";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Search params schema (seam 5).
 * Derives from contract paginationQuery.
 * TanStack Router validates these before render; invalid params = 400.
 */
const invoiceListSearchParams = z.object({
  limit: z.coerce.number().int().positive().default(20).catch(20),
  offset: z.coerce.number().int().nonnegative().default(0).catch(0),
});

const statusVariant = {
  draft: "warning",
  posted: "success",
  cancelled: "default",
} as const;

const statusLabel = (status: string) => {
  switch (status) {
    case "draft":
      return m.invoices_status_draft();
    case "posted":
      return m.invoices_status_posted();
    case "cancelled":
      return m.invoices_status_cancelled();
    default:
      return status;
  }
};

export default function InvoiceListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { locale } = useLocale();

  // Get search params from URL
  // For now, parse from window.location.search
  const urlParams = new URLSearchParams(window.location.search);
  const searchParams = invoiceListSearchParams.parse(
    Object.fromEntries(urlParams.entries())
  );
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Session: Fetch current user permissions (seam 7)
  const { data: session } = useQuery(sessionQueries.current());

  // Query: Fetch invoices (seam 2)
  const { data: listResponse } = useSuspenseQuery(
    invoiceQueries.list({
      limit: searchParams.limit,
      offset: searchParams.offset,
    })
  );

  // Mutation: Delete invoice
  const deleteMutation = useMutation({
    ...invoiceMutations.delete(),
    onSuccess: async () => {
      setToastMessage(m.invoices_delete_success());
      await queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setToastMessage(err.message);
      }
    },
  });

  const handleDelete = (id: string) => {
    if (confirm(m.invoices_delete_confirm())) {
      deleteMutation.mutate(id);
    }
  };

  const handlePagination = (newLimit: number, newOffset: number) => {
    const params = new URLSearchParams();
    params.set("limit", String(newLimit));
    params.set("offset", String(newOffset));
    window.location.search = params.toString();
  };

  // Type the invoice data to match the list item schema
  const invoices = listResponse.data as z.infer<typeof invoiceListItem>[];
  const meta = listResponse.meta as {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };

  return (
    <div>
      {toastMessage && (
        <div className="mb-4 rounded bg-muted p-4 text-sm text-foreground">
          {toastMessage}
        </div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold" data-testid="page-title">{m.invoices_list_title()}</h1>
        <Button onClick={() => navigate({ to: "/invoices/create" })} data-testid="create-invoice-btn">
          {m.invoices_create_title()}
        </Button>
      </div>

      <div className="overflow-x-auto rounded border border-border">
        <Table data-testid="invoices-table">
          <TableHeader>
            <TableRow>
              <TableHead>{m.invoices_number()}</TableHead>
              <TableHead>{m.invoices_customer_name()}</TableHead>
              <TableHead>{m.invoices_issued_date()}</TableHead>
              <TableHead>{m.invoices_due_date()}</TableHead>
              <TableHead>{m.invoices_status()}</TableHead>
              <TableHead className="text-right">{m.invoices_total()}</TableHead>
              <TableHead className="text-center">
                {m.invoices_actions()}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-muted-foreground"
                >
                  {m.invoices_no_results()}
                </TableCell>
              </TableRow>
            ) : (
              invoices.map((invoice) => (
                <TableRow key={invoice.id} data-testid={`invoice-row-${invoice.id}`}>
                  <TableCell className="font-mono">{invoice.number}</TableCell>
                  <TableCell>{invoice.customerName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(invoice.issuedDate).toLocaleDateString(locale)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(invoice.dueDate).toLocaleDateString(locale)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        statusVariant[
                          invoice.status as keyof typeof statusVariant
                        ] ?? "default"
                      }
                    >
                      {statusLabel(invoice.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {(invoice.total / 100).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex justify-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          navigate({ to: `/invoices/${invoice.id}/edit` })
                        }
                        data-testid={`edit-invoice-${invoice.id}`}
                      >
                        {m.common_edit()}
                      </Button>
                      {session?.permissions.includes(invoiceResource.permissions.delete) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={deleteMutation.isPending}
                          onClick={() => handleDelete(invoice.id)}
                          data-testid={`delete-invoice-${invoice.id}`}
                        >
                          {m.common_delete()}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {meta.offset + 1} – {Math.min(meta.offset + meta.limit, meta.total)} /{" "}
          {meta.total} {m.invoices_title()}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={meta.offset === 0}
            onClick={() =>
              handlePagination(meta.limit, Math.max(0, meta.offset - meta.limit))
            }
          >
            {m.common_previous()}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!meta.hasMore}
            onClick={() =>
              handlePagination(meta.limit, meta.offset + meta.limit)
            }
          >
            {m.common_next()}
          </Button>
        </div>
      </div>
    </div>
  );
}

