# emas-pos Pull from kongmy-stack Template

**Evidence source:** emas-pos STACK-MIGRATION.md (convergence plan, dated 2026-07-12) · emas-pos packages/ (14 packages: events, db, pos-kernel, registry, domain-gold, country-my, crypto, accounting-contract, config, control, ui) · kongmy-stack EXECUTION.md (wave/thread briefs) · CLAUDE.md (locked architecture, 8 seams).

**Constraint:** emas-pos is read-only SOURCE; never copy product IP (Aurum licensing/crypto/control-plane) into the public stack. Extract ONLY platform generics.

---

## Ranked Pull Table

| Rank | Feature | emas-pos Evidence | Exists in Template | Gap | Plan Status | Notes |
|------|---------|-------------------|-------------------|-----|-------------|-------|
| **1 (CONFIRMED)** | **Queue: ONE interface, three impls** | Uses async job processing for: receipts PDF generation (background), settlement reconciliation, audit log exports, periodic sync with control plane. Currently no queue; will pull `modules/queue` post-stack-T1. | ADR-0012 ✓ · spikes/a-pgboss-pglite/conformance ✓ · interface locked; pg-boss impl ✓; PGlite lane from Spike A (passing) | Will build T5 phase (this thread) | **Wave 2** (owned by this thread) | pg-boss v12.26.0 vs @electric-sql/pglite v0.5.4; conformance suite 6 assertions × 3 lanes all passing in spike; PGlite file-backed has restart durability script. CF Queues stub only (Workers lane ships on first deployment). |
| **2 (CONFIRMED)** | **AuthZ: roles-as-data, org/branch RLS** | Emas-pos has **reference implementation** in `@aurum/db::withScope()` (org_id, branch_id, is_owner predicate). Receipts/transactions scoped by branch; staff permissions per role assigned in tenant admin. Will converge to kongmy-stack AuthZ pattern. | ADR-0008 ✓ · authz tables/predicates defined · role-seeded data (TBD: emas-pos shape or generic) · permission matrix generation from contracts (TBD) | Tables exist; enforcement point ✓; role-seeding & permission-matrix codegen (Wave A authz thread) | **Wave 2** (T6 thread building authz enforcement) | emas-pos's branch-level scoping is the **reference for `withScope`** (will vendor back). Emas-pos pulls: template pattern + role/permission seeded data once wave 2 lands. |
| **3 (WAVE 2+)** | **Events: envelope + HLC + outbox + bus** | Emas-pos has `@aurum/events` (canonical envelope struct, Lamport-clock timestamps for ordering, transactional outbox pattern, in-proc bus for subscribers). Used for: receipt posted event → triggers PDF, sale event → ledger postings, sync heartbeat events to control plane. Will extract generics and vendor back. | ADR-0010 (tracing/audit/events distinction) ✓ · schema TBD | Events module not yet written (source: emas-pos @aurum/events) | **Wave 2+** (new thread) | Must extract from emas-pos source first, de-domain it, test on server PG + PGlite, then vendor. Emas-pos will pull the genericized version back. Transactional outbox critical for exactly-once guarantee on event→PDF/ledger-post. |
| **4 (WAVE 2+)** | **Money VO: allocation, wire format** | Emas-pos `@aurum/pos-kernel::Money/Weight` — used everywhere (item price, discount, tax, total). Allocation must sum exactly (no lost cents). Generalized: decimal.js internal, minor-units on wire. | **modules/money ✓ SHIPPED** (wave 2 T7; allocation + property tests + codec) | None — already complete | **COMPLETE** (delivered by T7) | emas-pos validates: API wire format, allocation sum properties, zod codec round-trip. All passing in `modules/money/tests/`. Emas-pos pulls via `scripts/add.ts` and inherits the fast-check property test suite. |
| **5 (WAVE 2+)** | **Agentic: registry.execute() + MCP tools** | Emas-pos has `@aurum/registry` — single audited door for all service calls (REST + MCP + future agents). Zod contract → tool schema derivation (no hand-written JSON Schema). Tools: `execute_receipt_sale`, `post_receipt`, etc. Will extract to `modules/agentic` + platform pattern. | ADR-0002 (pattern vocab: seams+adapters, no taxonomies) · ADR-0003 (ctx injection, one middleware) · tools/list filtered by `can()` (ADR-0008) · `registry.execute()` interface (TBD) | Registry interface not yet written | **Wave 2+** (new thread) | Emas-pos's `registry` is the **reference implementation** (will extract, de-domain, and vendor back). Platform gains: autonomy gate (suggest/assist/auto), tool-result summary for LLMs, single audit log. |
| **6 (WAVE 2+)** | **Contract + Scalars** | Emas-pos needs: `DocumentNumber` (per-tenant gapless sequences; 000001–999999 for receipts, separate sequence for invoices), `Money` scalars (wire: integer basis points), `CurrencyCode`, `TaxCode`, phone E.164, structured Address. Pull from `packages/contract/scalars.ts` as the schema SSOT. | ADR-0009 ✓ (scalar vocabulary locked) · `packages/contract/scalars.ts` (TBD build) | Locked in ADR; not yet coded | **Wave 2+** (T3 must ship first) | Emas-pos pulls: `DocumentNumber` type + `createSequence()` helper, `Money` codec (round-trip to wire format), address validators, TaxCode enum with Malaysian tax codes. Tenancy rule: `DocumentNumber` sequence is org-scoped + branch-scoped (emas-pos reference). |
| **7 (WAVE 3)** | **Document Lifecycle: draft→posted→cancelled** | Receipt has states: draft (edit line items) → posted (read-only, audit log sealed) → cancelled (zero reversal). Corrections are reversals (new receipt linking to original). Posted doc immutable, never soft-deleted. | ADR-0009 ✓ (lifecycle locked) · permission matrix will enforce: can draft, can post, cannot edit posted, can reverse | Schema TBD; enforcement via authz | **Wave 2+** (authz + audit table) | Emas-pos validates: `posted_at` timestamp on receipt, immutability check, reversal creation from duplicate receipt template. State machine likely in contract (enum) + service logic (guards). |
| **8 (WAVE 3+)** | **i18n: message catalog + locale threading** | Receipts in Bahasa Malaysia **or** Simplified Chinese (multi-jurisdictional POS). Locale per: user pref → tenant setting → default en. Plurals + ICU formatting (dates, numbers, currency). | ADR-0007 ✓ (i18n locked) · Spike C will pick Paraglide vs i18next | No catalog or Intl plumbing yet | **Wave 2+** (Spike C, T6) | Emas-pos strings: receipt header (6 languages eventually), error messages (rendered via code + catalog), number/currency formatting (Intl API). T6 implements `t()` helper + locale ctx + error-code rendering. Emas-pos pulls completed i18n seam. |
| **9 (PHASE 2+)** | **Document sequences: gapless, per-org/branch** | Receipts numbered 000001–999999 per branch (reference: ERPNext naming series). Invoices, credit memos separate sequences. Control plane (product IP) manages sequence state for multi-location fleets. | ADR-0009 ✓ (DocumentNumber scalar) · database sequences or app-managed counter (TBD) | Scalar defined; impl TBD | **Wave 3+** (authz/audit table schema) | Emas-pos reference: `@aurum/db::getNextDocumentNumber()` (transactional; avoid gaps under concurrency). Stack impl will be DB sequence + app wrapper or Firestore-style increment-and-read (for embedded PGlite). Emas-pos reuses the impl. |
| **10 (PHASE 2+)** | **country-my: TIN, SSM, SST, MSIC, MyInvois** | Emas-pos target market is Malaysia. Needs: state/postcode validation, TIN/SSM/SST ID formats, MSIC industry codes, MyInvois e-invoice generation (UBL 2.1, PKCS#7 signing). | ADR-0009 (country modules: `domain ⊥ country`) ✓ · `modules/country-my` (not yet built) | Emas-pos has `@aurum/country-my` (source material) | **Phase 2+** (explicit later) | Extract from `~/Projects/emas-pos/packages/country-my`, de-domain (keep only validation logic + UBL mapper), add tests, vendor back to emas-pos. MyInvois OAuth2 + sandbox/prod endpoints will be integration-tested. Not a Wave 2 blocker; user can test with mock invoices. |
| **11 (PHASE 3)** | **Ledger: double-entry, GL postings, FY/period close, aging** | Accounting app (separate repo `~/Projects/emas-pos/apps/accounting`) needs: account tree (ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE), balanced JournalEntry, auto-GL posting from receipts, FiscalYear + period-close routines, trial balance/P&L/BS queries, payment aging. | `modules/ledger` (not yet designed) · ADR-0009 (document lifecycle) · reference code: `~/Projects/references/vibe_accounting_malaysia` | Not yet built | **Phase 3+** | Emas-pos will provide the use cases (receipt→COGS/AR, expense→accounts payable). Stack module must verify: Σdebits=Σcredits per entry + period, no negative equity. Emas-pos pulls finished module once built. |
| **? (NOT IN PLAN)** | **Realtime: SSE or WebSocket** | Receipts change in real-time on multiple tills (same branch). Admin dashboard shows live sales ticker. Currently no real-time seam planned in kongmy-stack. Candidate: SSE (ADR-0006 placeholder) or Centrifugo. | ADR-0006 (realtime seam, contract now / impl on first pull — placeholder) · not yet locked | Seam interface defined; impl TBD | **Deferred** (no consumer yet) | Emas-pos may need this, but is not a Wave 2 blocker. If needed: server→Query invalidation (SWR pattern) sufficient for first cut. Full seam (SSE envelope, reconnect, subscription model) ships when a product needs it. |
| **? (NOT IN PLAN)** | **Storage seam: presigned direct upload** | Receipt photos (items, customer ID). Currently: TBD if S3 presigned URLs or Cloud Storage. | ADR-0006 (storage seam — placeholder) · not yet locked | Seam interface defined; impl TBD | **Deferred** (no consumer yet) | Emas-pos may need this. Seam: app asks server for presigned URL, browser uploads directly, callback triggers metadata post. Stack ships when a product does image/file uploads. |
| **? (NOT IN PLAN)** | **Notifier seam: email + Telegram + Lark** | Daily sales report → owner email; exceptions → Telegram group; audit log excerpts → Slack. | ADR-0006 (notifier seam — placeholder) · not yet locked | Seam interface defined; impl TBD | **Deferred** (no consumer yet) | One interface, three impls (email via SendGrid, Telegram API, Slack webhook). Emas-pos may need this for alerts. Stack ships when a product needs it. |

---

## Key Findings & Flags

### Extraction Checklist (must complete before emas-pos pull)
- [ ] **Events module**: extract `@aurum/events` generics (envelope struct, HLC impl, outbox pattern, bus interface), de-domain (no Aurum licensing logic), test on PG + PGlite, document seam for external event subscribers (not just in-proc). → Blocked until Wave 2+ thread starts.
- [ ] **Agentic module**: extract `@aurum/registry` → `registry.execute()` signature, tool-schema derivation from zod, autonomy gate (suggest/assist/auto levels), audit-log entry shape. De-domain (no Aurum control-plane tool names). → Blocked until Wave 2+ thread starts.
- [ ] **country-my module**: extract `packages/country-my` (TIN validation, SSM/SST id formats, MSIC codes, UBL mapper, MyInvois OAuth2 flow), add tests, document integration point for e-invoice submit/poll/cancel. → Blocked until Phase 2+ thread starts.
- [ ] **Contract scalars**: add `DocumentNumber` type + `createSequence()` pattern to `packages/contract/scalars.ts` once T3 ships. → Blocked until Wave 2+ (after T3 merges).

### Risks & Constraints
1. **Authz enforcement not yet written** (Wave A thread building it). Emas-pos has reference; stack must generalize from org/branch to arbitrary tenant scopes. Until then, emas-pos cannot converge fully — it will keep `@aurum/db::withScope()` and audit locally.
2. **Events outbox must guarantee exactly-once**. Emas-pos PDF generation + ledger postings depend on idempotent subscribers. Stack module must test: process kill mid-event, restart = resume from marker (not duplicate). Spike needed.
3. **DocumentNumber sequences under concurrency**. PGlite is single-writer; stack must document: if concurrent requests (same branch, multiple tills), how does gapless guarantee hold? (Likely: centralized sequence service, or transaction-safe increment-and-read).
4. **i18n messiness deferred**. Wave 3 (Spike C pick). Emas-pos has Bahasa Malaysia + Simplified Chinese (not just English). Catalog must ship multi-lingual, not stub with en-only. → Risk if Spike C picks a library with poor CJK support.
5. **No realtime seam yet**. SSE placeholder in ADR-0006 means emas-pos tills (same branch, live updates) will not have server-push at Wave 2. Fallback: polling. If emas-pos product deadline requires live updates, a prestige tech-debt.

### What emas-pos Will NOT Pull (or pulls late)
- **Kotlin client pipeline** — emas-pos is TypeScript-only (web, Tauri native). Stack is TS-first; Kotlin codegen not yet planned. → Phase 3+.
- **Admin blocks reference** (DataTable, form components, layout blocks) — emas-pos pulls **vendored UI** from sapphire-ui registry (shared design). These live in sapphire, not kongmy-stack. Kong-stack just holds the **integration pattern** (queryOptions, zodResolver, error mapping). → Coordinated via sapphire-ui REGISTRY-PLAN.
- **Ledger module** — needed for the accounting app, not main POS. Can ship Phase 3+; does not block Wave 2 convergence.

---

## Build Order & Dependencies

**Wave 2 (this thread + subsequent):**
1. ✓ Spikes (T1) — pg-boss × PGlite PASSING; i18n library decision + OpenAPI adapter pick needed.
2. ✓ Skeleton infra (T2) — repo, deploy, CI/CD, `scripts/add.ts`.
3. ✓ Contract + scalars (T3) — zod SSOT, helpers, CI checks (pending: `DocumentNumber` + MyInvois scalars).
4. ✓ core + db (T4) — drizzle, `withScope`, audit table, error types.
5. **→ T5 API app** (this thread): uses T1–T4 output.
   - Authz enforcement at command door (sourced from emas-pos reference, codegen tested on Wave A branch).
   - Audit log writes (one entry per command, autonomy level recorded).
   - Routes + services wired via ctx injection.
   - Generated TS client for emas-pos consumption.
   - Test: 13+ contract tests per ADR-0001 (conformance suite pattern, not integration).

**Wave 2+ (pull-driven):**
- **`modules/queue`** (this thread) — interface + pg-boss impl + conformance tests.
- **`modules/money`** ✓ T7 complete — emas-pos validates and inherits.
- **`modules/events`** (TBD) — extract + de-domain + test + vendor.
- **`modules/agentic`** (TBD) — extract registry + de-domain.

**Phase 2+ (later):**
- `modules/ledger` — reference code (vibe-accounting-malaysia), emas-pos validation (ledger postcodes + aging).
- `modules/country-my` — extract + de-domain + test + vendor.

---

## Evidence
- emas-pos STACK-MIGRATION.md: "Platform packages move OUT … built there, vendored back here"
- emas-pos packages/db: `withScope(org, branch)` reference RLS pattern.
- emas-pos packages/events: transactional outbox (`write event + update offset atomically`).
- emas-pos packages/registry: `execute()` audit door + zod tool schemas.
- emas-pos packages/pos-kernel: Money VO allocation tests + pricing deciders.
- emas-pos packages/country-my: TIN/SSM/SST validators + MyInvois UBL + PKCS#7.
- spikes/a-pgboss-pglite/conformance/suite.ts: 6 assertions × 3 lanes (all passing).
- ADR-0005, ADR-0008, ADR-0009, ADR-0010, ADR-0012 (locked decisions).
- EXECUTION.md: wave/thread briefs (T1–T8 sequencing).
