/**
 * Queue interface: ONE enqueue/worker interface, three implementations
 *
 * Abstraction over three lanes:
 * 1. PostgreSQL via pg-boss (server PG, always available)
 * 2. PGlite via pg-boss (embedded/offline, file-backed)
 * 3. Cloudflare Queues (Workers, shipped on first deployment)
 *
 * Key properties (enforced across all lanes):
 * - Enqueue returns job ID (ULID)
 * - Retry semantics: initial + retryLimit attempts (e.g., retryLimit=2 → 3 total attempts)
 * - Scheduled jobs fire at startAfter time
 * - Dead-letter: exhausted retries → failed state
 * - Graceful shutdown: stop() waits for in-flight jobs
 *
 * Typed payload: caller provides type T, enforced at work() registration
 * No class taxonomies; use union + exhaustive switch for job routing (ADR-0002)
 */

/**
 * Job payload type — caller supplies generic T for type-safe routing
 * Extends to any serializable value: object, array, string, number, boolean
 */
export type JobPayload = Record<string, unknown>;

/**
 * Job metadata visible to worker handler
 */
export interface Job<T extends JobPayload = JobPayload> {
  /** Unique job ID (ULID or similar) */
  id: string;
  /** Queue name */
  name: string;
  /** Job payload */
  data: T;
  /** Attempt number (1-based: 1 = initial, 2+ = retries) */
  attempt_number: number;
  /** Total retry limit specified at enqueue time */
  retry_limit: number;
  /** When job was first enqueued (ISO-8601 UTC) */
  created_on: string;
  /** When job started this attempt (ISO-8601 UTC) */
  started_on: string | null;
  /** State of job: created | active | completed | failed | cancelled | retry | expired */
  state:
    | "created"
    | "active"
    | "completed"
    | "failed"
    | "cancelled"
    | "retry"
    | "expired";
}

/**
 * Handler function: worker receives Job and may throw (triggering retry)
 * Return value is ignored; worker must explicitly handle idempotency
 */
export type JobHandler<T extends JobPayload = JobPayload> = (
  job: Job<T>
) => Promise<void>;

/**
 * Options at enqueue time
 */
export interface EnqueueOptions {
  /** Max retry count (default: 0 = no retries, only one attempt) */
  retryLimit?: number;
  /** Delay between retries in ms (default: 5000) */
  retryDelay?: number;
  /** Time to wait before starting job (ms) or ISO-8601 UTC datetime string (default: immediate) */
  startAfter?: number | string;
  /** Priority level (higher = sooner; default: 0; range varies by impl) */
  priority?: number;
}

/**
 * Options at work() registration
 */
export interface WorkOptions {
  /**
   * How often to poll for new jobs (ms). Applies per work() registration, overriding the
   * instance-wide default for this queue only.
   *
   * **Minimum 500ms** on the Postgres lanes — pg-boss rejects anything faster. 500-1000 balances
   * latency against battery/CPU on embedded PGlite; 1000-5000 is typical for server PG.
   * Not applicable to CF Queues (push-driven).
   */
  pollIntervalMs?: number;
  /**
   * Number of workers to run for this queue, each polling and processing jobs independently
   * (default 1). This is real parallelism within one node: a value of 3 means up to 3 handler
   * invocations in flight at once, so handlers must tolerate running concurrently with themselves.
   * Not a cross-node limit — n nodes at concurrency 3 give up to 3n in flight.
   */
  concurrency?: number;
}

/**
 * Schedule options
 */
export interface ScheduleOptions {
  /** Cron expression (e.g., "0 9 * * *" for daily at 9 AM UTC) */
  cron: string;
  /** Timezone for cron evaluation (default: UTC) */
  timezone?: string;
}

/**
 * Job filter for queries (future use, not in Wave 2)
 */
export interface JobQuery {
  state?: Job["state"][];
  limit?: number;
  offset?: number;
}

/**
 * Core Queue interface: ONE entrance, three exits (implementations)
 * All methods are async; errors bubble as exceptions
 *
 * ADR-0012: queue architecture
 * ADR-0002: no class taxonomies, seams + adapters pattern
 */
export interface Queue {
  /**
   * Enqueue a job: idempotent on job ID
   * Returns job ID (ULID, prefixed per ADR-0004)
   *
   * Usage: const jobId = await queue.enqueue("send-email", {to: "user@ex.com"}, {retryLimit: 2});
   */
  enqueue<T extends JobPayload = JobPayload>(
    name: string,
    payload: T,
    options?: EnqueueOptions
  ): Promise<string>;

  /**
   * Register a worker: runs handler for every job on this queue
   * Multiple calls to work() for the same queue name = multiple workers (multiplexing)
   * Returns subscription ID (for later unsubscribe)
   *
   * Typed: caller passes T to match enqueue() payload type
   * Handler must be idempotent (job may re-run if worker crashes after handler completes)
   *
   * Usage:
   * await queue.work("send-email", async (job) => {
   *   await sendEmail(job.data);
   * });
   */
  work<T extends JobPayload = JobPayload>(
    name: string,
    handler: JobHandler<T>,
    options?: WorkOptions
  ): Promise<string>;

  /**
   * Unsubscribe a worker (stop processing a queue)
   * Existing in-flight jobs continue; new jobs wait for next worker registration
   *
   * Usage: await queue.unsubscribe("send-email");
   */
  unsubscribe(name: string): Promise<void>;

  /**
   * Schedule a recurring job: runs periodically per cron schedule
   * Returns schedule ID
   *
   * Note: Cron semantics are impl-dependent (pg-boss, CF Queues have different precision)
   * Default timezone: UTC (override with timezone option)
   *
   * Usage: await queue.schedule("daily-report", {cron: "0 9 * * *"}, {report_type: "sales"});
   */
  schedule<T extends JobPayload = JobPayload>(
    name: string,
    payload: T,
    options: ScheduleOptions
  ): Promise<string>;

  /**
   * Cancel a scheduled job
   *
   * Usage: await queue.cancelSchedule(scheduleId);
   */
  cancelSchedule(scheduleId: string): Promise<void>;

  /**
   * Graceful shutdown: unsubscribe all workers, wait for in-flight jobs,
   * close connection/pool
   *
   * Timeout: impl-dependent (default 30s); in-flight jobs after timeout are lost
   *
   * Usage: await queue.stop();
   */
  stop(): Promise<void>;
}

/**
 * Helper: dispatch job to handler based on queue name
 * Unions + exhaustive switch pattern per ADR-0002
 *
 * Usage:
 * type JobType = {name: "send-email", data: {to: string}} | {name: "generate-pdf", data: {path: string}};
 * await queue.work("send-email", (job) => dispatch(job, handlers));
 * const handlers = {
 *   "send-email": (j) => sendEmail(j.data),
 *   "generate-pdf": (j) => generatePdf(j.data),
 * }
 */
export function dispatch<
  T extends { readonly name: string; readonly data: JobPayload },
>(
  job: Job<T["data"]>,
  handlers: Record<string, JobHandler<JobPayload>>
): Promise<void> {
  const handler = handlers[job.name];
  if (!handler) {
    throw new Error(`No handler registered for queue name: ${job.name}`);
  }
  return handler(job);
}
