/**
 * Queue implementation via pg-boss
 *
 * Handles two lanes:
 * 1. PostgreSQL server (via connection string)
 * 2. PGlite embedded (via instance or connection string)
 *
 * ADR-0012: PGlite lane uses pg-boss (Spike A verified conformance)
 * Versions: pg-boss v12.26.0, @electric-sql/pglite v0.5.4
 *
 * Key architecture:
 * - pg-boss's built-in fromPglite() adapter handles PGlite wiring
 * - Queue.name = pg-boss queue name (auto-created on first send/work)
 * - Job.id = pg-boss job ID (UUID or similar; prefixed per product needs)
 * - State vocabulary from pg-boss: created|active|completed|failed|retry|cancelled|expired
 * - Retry semantics: retryLimit applies to attempt count (1 initial + N retries)
 *
 * Caveats (ADR-0012, Implementation Notes section):
 * - PGlite is single-writer; concurrent writers to same database are unsafe
 * - Polling interval: 100-1000ms for embedded (battery/CPU), 1000-5000ms for server
 * - Restart durability: on process restart, jobs in-flight resume (via pg-boss schema)
 * - Scheduler stability: pg-boss background maintenance is transparent
 *
 * @see docs/adr/0012-queue-pglite-lane.md
 * @see spikes/a-pgboss-pglite/conformance/ (test suite model)
 */

import { PgBoss, fromPglite } from "pg-boss";
import type { SendOptions, SchedulingOptions, JobWithMetadata } from "pg-boss";
import type {
  Queue,
  JobPayload,
  Job,
  JobHandler,
  EnqueueOptions,
  WorkOptions,
  ScheduleOptions,
} from "./queue.js";

/**
 * PgBoss configuration input
 * Can accept either:
 * 1. Connection string (PG or PGlite)
 * 2. PGlite instance
 */
export interface PgBossConfig {
  connectionString?: string;
  pglite?: object; // PGlite instance
  newJobCheckInterval?: number; // polling interval in ms for job checks (pg-boss api)
}

/**
 * Create a pg-boss Queue implementation
 *
 * @param config - Connection config or PGlite instance
 * @returns Queue instance
 *
 * Usage (server PG):
 *   const q = await pgbossQueue({connectionString: process.env.DATABASE_URL});
 *
 * Usage (PGlite in-memory):
 *   const q = await pgbossQueue({pglite: new PGlite()});
 *
 * Usage (PGlite file-backed):
 *   const q = await pgbossQueue({pglite: new PGlite("file://./queue.db")});
 */
export async function pgbossQueue(
  config: PgBossConfig,
  /** internal: helpers that construct the PGlite instance own its lifecycle */
  ownsPglite = false
): Promise<Queue> {
  // Build pg-boss config based on input
  interface BossConstructorOptions {
    db?: object;
    connectionString?: string;
    newJobCheckInterval?: number;
  }
  const bossConfig: BossConstructorOptions = {};

  if (config.pglite) {
    // PGlite instance provided
    // Per ADR-0012 spike: fromPglite() is async and returns the db adapter
    const db = await fromPglite(config.pglite as unknown as Parameters<typeof fromPglite>[0]);
    (bossConfig as Record<string, unknown>).db = db;
  } else if (config.connectionString) {
    // Connection string (server PG)
    bossConfig.connectionString = config.connectionString;
  } else {
    throw new Error(
      "pgbossQueue: must provide either connectionString or pglite instance"
    );
  }

  // Apply polling interval if specified
  if (config.newJobCheckInterval !== undefined) {
    bossConfig.newJobCheckInterval = config.newJobCheckInterval;
  }

  // Create and start pg-boss instance
  // pg-boss types are loose; cast to any to work around type mismatches
  // Runtime behavior is proven by spike conformance suite
  const boss = new PgBoss(bossConfig as unknown as ConstructorParameters<typeof PgBoss>[0]);
  await boss.start();

  // Track active subscriptions for unsubscribe
  const subscriptions = new Map<string, string>(); // queueName -> subscriptionId

  // Implement Queue interface
  return {
    async enqueue<T extends JobPayload = JobPayload>(
      name: string,
      payload: T,
      options?: EnqueueOptions
    ): Promise<string> {
      // pg-boss v10+ semantics (verified empirically — jobs arrived with
      // retry_limit=0 when retry options rode the send): retry policy is a
      // QUEUE-level setting, not a send option. So retry options are applied
      // via createQueue/updateQueue; only startAfter/priority ride the send.
      // Units: pg-boss retryDelay and numeric startAfter are SECONDS.
      const queueOptions: { retryLimit?: number; retryDelay?: number } = {};
      if (options?.retryLimit !== undefined) {
        queueOptions.retryLimit = options.retryLimit;
      }
      if (options?.retryDelay !== undefined) {
        queueOptions.retryDelay = options.retryDelay;
      }

      const sendOptions: Partial<SendOptions> = {};
      if (options?.startAfter !== undefined) {
        // number = delay in seconds; ISO string = absolute time (pass as Date)
        sendOptions.startAfter =
          typeof options.startAfter === "number"
            ? options.startAfter
            : new Date(options.startAfter);
      }
      if (options?.priority !== undefined) {
        sendOptions.priority = options.priority;
      }

      // Create the queue with its retry policy; if it already exists and a
      // policy was requested, update it so the policy actually applies.
      try {
        await boss.createQueue(name, queueOptions);
      } catch {
        if (Object.keys(queueOptions).length > 0) {
          try {
            await boss.updateQueue(name, queueOptions);
          } catch {
            // queue exists with a fixed policy; proceed with existing policy
          }
        }
      }

      // Enqueue and return job ID (per spike: boss.send signature)
      const jobId = await boss.send(name, payload, sendOptions);
      if (!jobId) {
        throw new Error(`Failed to enqueue job on queue ${name}`);
      }
      return jobId;
    },

    async work<T extends JobPayload = JobPayload>(
      name: string,
      handler: JobHandler<T>,
      _options?: WorkOptions
    ): Promise<string> {
      // Note: WorkOptions (pollIntervalMs, concurrency) are set at pg-boss init time,
      // not per work() call. The Queue interface accepts them for API completeness,
      // but they don't apply here. For per-job polling control, create separate Queue
      // instances with different newJobCheckInterval values.

      // Create queue if it doesn't exist
      try {
        await boss.createQueue(name);
      } catch {
        // Queue may already exist; ignore
      }

      // pg-boss v12 work() delivers a BATCH: the handler receives Job<T>[]
      // (batchSize defaults to 1). includeMetadata gives us the real
      // retryCount/state/timestamps — without it those fields don't exist.
      void boss.work(
        name,
        { includeMetadata: true, batchSize: 1 },
        async (pgbossJobs: JobWithMetadata<T>[]) => {
          const pgbossJob = pgbossJobs[0];

          const job: Job<T> = {
            id: pgbossJob.id,
            name: pgbossJob.name,
            data: pgbossJob.data,
            attempt_number: pgbossJob.retryCount + 1,
            retry_limit: pgbossJob.retryLimit,
            created_on: pgbossJob.createdOn.toISOString(),
            started_on: pgbossJob.startedOn?.toISOString() ?? null,
            state: pgbossJob.state,
          };

          await handler(job);
        }
      );

      // Return a generated subscription ID (work() doesn't return one in pg-boss)
      const subscriptionId = `${name}_${Date.now()}`;
      subscriptions.set(name, subscriptionId);
      return subscriptionId;
    },

    async unsubscribe(name: string): Promise<void> {
      try {
        await boss.offWork(name);
      } catch {
        // Silently ignore if already unsubscribed
      }
      subscriptions.delete(name);
    },

    async schedule<T extends JobPayload = JobPayload>(
      name: string,
      payload: T,
      options: ScheduleOptions
    ): Promise<string> {
      // Create queue if it doesn't exist
      try {
        await boss.createQueue(name);
      } catch {
        // Queue may already exist; ignore
      }

      // Build schedule options - pg-boss supports cronPattern
      const scheduleOptions: Record<string, unknown> = {
        cronPattern: options.cron,
      };

      if (options.timezone) {
        scheduleOptions.timezone = options.timezone;
      }

      // Per spike: boss.schedule(queueName, payload, options)
      // Cast payload and options to work around pg-boss type issues
      const scheduleId = await (
        boss.schedule as unknown as (
          name: string,
          payload: unknown,
          options: Record<string, unknown>
        ) => Promise<string>
      )(name, payload, scheduleOptions);

      return scheduleId ?? `schedule_${name}_${Date.now()}`;
    },

    async cancelSchedule(scheduleId: string): Promise<void> {
      // pg-boss unschedule API is limited; best-effort only
      try {
        await boss.unschedule(scheduleId);
      } catch {
        // Silently fail; schedule cancellation is best-effort
      }
    },

    async stop(): Promise<void> {
      // Unsubscribe all workers
      for (const name of subscriptions.keys()) {
        try {
          await boss.offWork(name);
        } catch {
          // Ignore errors during shutdown
        }
      }
      subscriptions.clear();

      // Fully drain before returning: without wait:true, pg-boss's poll loop
      // can fire after PGlite teardown — an async error AFTER the test run,
      // which bun test rightly reports as a dirty exit (observed as code 99).
      await boss.stop({ graceful: true, timeout: 10_000 });

      // Close a PGlite instance we created ourselves (helpers); never close
      // a caller-provided one.
      if (config.pglite && ownsPglite) {
        const closable = config.pglite as { close?: () => Promise<void> };
        await closable.close?.();
      }
    },
  };
}

/**
 * Helper: create a Queue for PGlite file-backed database
 *
 * Usage:
 *   const q = await pgbossQueueFile("./queue.db");
 *   await q.enqueue("task", {data: "value"});
 */
export async function pgbossQueueFile(filePath: string): Promise<Queue> {
  // Import PGlite dynamically to avoid hard dependency
  const { PGlite } = await import("@electric-sql/pglite");
  const pglite = new PGlite(`file://${filePath}`);

  // Recommended polling for file-backed: 500ms (balance latency vs file I/O)
  return pgbossQueue({
    pglite,
    newJobCheckInterval: 500,
  }, true);
}

/**
 * Helper: create a Queue for PGlite in-memory
 *
 * Usage:
 *   const q = await pgbossQueueMemory();
 *   await q.enqueue("task", {data: "value"});
 *
 * Note: jobs do NOT persist across process restart (by design)
 */
export async function pgbossQueueMemory(): Promise<Queue> {
  // Import PGlite dynamically to avoid hard dependency
  const { PGlite } = await import("@electric-sql/pglite");
  const pglite = new PGlite();

  // Recommended polling for in-memory: 100ms (low latency, minimal battery drain)
  return pgbossQueue({
    pglite,
    newJobCheckInterval: 100,
  }, true);
}
