import { z } from 'zod'
import { uuidv7 } from 'uuidv7'

/**
 * Actor type: who/what caused an event.
 * @example 'human' | 'agent' | 'system'
 */
export const ActorTypeSchema = z.enum(['human', 'agent', 'system']).describe('Actor type: human, agent, or system')
export type ActorType = z.infer<typeof ActorTypeSchema>

/**
 * Actor: who/what caused an event.
 * model is set for agents (autonomy level + LLM identifier).
 */
export const ActorSchema = z.object({
  id: z.string().describe('Unique identifier of the actor (user ID, agent ID, or system name)'),
  type: ActorTypeSchema,
  model: z.string().nullable().describe('LLM model identifier if type is agent; null otherwise'),
})
export type Actor = z.infer<typeof ActorSchema>

/**
 * A domain event before sealing into an envelope.
 * Produced by domain handlers, seals via sealEvent() into EventEnvelope.
 */
export const DomainEventSchema = z.object({
  type: z.string().describe('Event type identifier (e.g. invoice.posted, order.shipped)'),
  payload: z.unknown().describe('Event payload; shape depends on type and version'),
  version: z.number().int().positive().optional().describe('Schema version of payload (default: 1)'),
})
export type DomainEvent<T = unknown> = z.infer<typeof DomainEventSchema> & { payload: T }

/**
 * Canonical, immutable event envelope (exactly-once delivery seam).
 * Every subsystem — projections, sync, audit, jobs, AI, MCP — consumes this shape.
 * causationId/correlationId make actions traceable end-to-end.
 * version makes schema evolution possible via upcasters.
 */
export const EventEnvelopeSchema = z.object({
  id: z.string().describe('Prefixed ULID event identifier (globally unique)'),
  type: z.string().describe('Event type (e.g. invoice.posted)'),
  version: z.number().int().positive().describe('Schema version of the payload'),
  orgId: z.string().describe('Organization ID (tenancy: org level)'),
  branchId: z.string().nullable().describe('Branch ID (tenancy: branch level, null for HQ)'),
  seq: z.number().int().nonnegative().describe('Per-branch sequence number (ordering key, ADR-0009)'),
  hlc: z.string().describe('Hybrid Logical Clock timestamp (lexicographically sortable, cross-branch causality)'),
  actor: ActorSchema,
  causationId: z.string().nullable().describe('ID of the command that caused this event (traceability)'),
  correlationId: z.string().describe('Trace ID; groups related events across time and services'),
  payload: z.unknown().describe('Event payload'),
  createdAt: z.string().datetime().describe('ISO-8601 UTC timestamp when event was sealed'),
})
export type EventEnvelope<T = unknown> = z.infer<typeof EventEnvelopeSchema> & { payload: T }

/**
 * Context supplied by the backbone when sealing a domain event into an envelope.
 * Includes org/branch tenancy, actor, seq, HLC, causation/correlation IDs.
 */
export const SealContextSchema = z.object({
  orgId: z.string().describe('Organization ID'),
  branchId: z.string().nullable().describe('Branch ID (null for HQ)'),
  actor: ActorSchema,
  causationId: z.string().nullable().describe('Command ID that caused this event'),
  correlationId: z.string().describe('Trace ID'),
  seq: z.number().int().nonnegative().describe('Per-branch sequence number'),
  hlc: z.string().describe('HLC timestamp (encoded)'),
})
export type SealContext = z.infer<typeof SealContextSchema>

/**
 * Seal a domain event into a canonical EventEnvelope.
 * Supplies envelope metadata (ID, timestamps, actor, tenancy) that the domain handler did not.
 * The sealed envelope is then appended to the outbox within the same transaction.
 *
 * @param e - Domain event with type, payload, and optional version
 * @param ctx - Tenancy, actor, seq, HLC, causation/correlation IDs from backbone
 * @returns Sealed envelope ready for outbox append
 */
export function sealEvent<T>(e: DomainEvent<T>, ctx: SealContext): EventEnvelope<T> {
  return {
    id: uuidv7(),
    type: e.type,
    version: e.version ?? 1,
    orgId: ctx.orgId,
    branchId: ctx.branchId,
    seq: ctx.seq,
    hlc: ctx.hlc,
    actor: ctx.actor,
    causationId: ctx.causationId,
    correlationId: ctx.correlationId,
    payload: e.payload,
    createdAt: new Date().toISOString(),
  }
}
