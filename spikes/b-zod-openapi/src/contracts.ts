// contracts.ts - Pure zod, no adapter imports (follows ADR-0001)
// This is what would live in packages/contract

import { z } from 'zod';

// Pagination query
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10).describe('Items per page'),
  offset: z.coerce.number().int().min(0).default(0).describe('Offset from start'),
  sort: z.enum(['name', '-name']).default('name').describe('Sort field'),
}).describe('Pagination query parameters');

// Item resource schemas
export const itemSchema = z.object({
  id: z.string().describe('Item ID'),
  name: z.string().describe('Item name'),
  description: z.string().optional().describe('Item description'),
  quantity: z.number().int().min(0).describe('Quantity in stock'),
  createdAt: z.string().datetime().describe('Creation timestamp'),
  updatedAt: z.string().datetime().describe('Last update timestamp'),
}).describe('Item resource');

export const createItemInputSchema = z.object({
  name: z.string().min(1).max(255).describe('Item name'),
  description: z.string().optional().describe('Item description'),
  quantity: z.number().int().min(0).describe('Initial quantity'),
}).describe('Create item input');

export const itemListResponseSchema = z.object({
  data: z.array(itemSchema).describe('Items'),
  meta: z.object({
    total: z.number().int().describe('Total count'),
    limit: z.number().int().describe('Items per page'),
    offset: z.number().int().describe('Offset'),
  }).describe('Pagination metadata'),
}).describe('Items list response');

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string().describe('Error code'),
    message: z.string().describe('Error message'),
    details: z.record(z.any()).optional().describe('Error details'),
  }).describe('Error object'),
}).describe('Error response');

// Type exports for convenience
export type Item = z.infer<typeof itemSchema>;
export type CreateItemInput = z.infer<typeof createItemInputSchema>;
export type ItemListResponse = z.infer<typeof itemListResponseSchema>;
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
