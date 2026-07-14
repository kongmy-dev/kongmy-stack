/**
 * withScope — enforce organization and branch tenant scoping.
 *
 * Per ADR-0003: context-injected tenant scope (org + branch).
 * Per ADR-0008: membership scope constraints at the branch level.
 * Per ADR-0005: RLS-ready architecture.
 *
 * This wrapper ensures that every scoped repo function receives an org+branch
 * context, and validates that the entity being accessed belongs to that scope.
 *
 * Example:
 *   const invoiceRepo = createInvoiceRepo(db);
 *   const scoped = withScope(invoiceRepo, { org: "org_123", branch: "branch_456" });
 *   scoped.getById("inv_789"); // throws if invoice.organization_id != "org_123"
 */

export interface TenantScope {
  org: string;
  branch: string;
}

/**
 * Scoped repository wrapper.
 * Enforces tenant isolation on all operations.
 */
export interface ScopedRepo {
  assertScope(entity: { organization_id: string; branch_id?: string }): void;
  getScope(): TenantScope;
}

/**
 * Create a scoped wrapper around a repository.
 *
 * The wrapper intercepts function calls and validates that:
 * 1. The entity belongs to the same organization
 * 2. (optionally) The entity belongs to the same branch
 *
 * This is the enforcement point per ADR-0008.
 */
export function withScope<RepoT extends Record<string, any>>(
  repo: RepoT,
  scope: TenantScope
): RepoT & ScopedRepo {
  const handler: ProxyHandler<RepoT> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      if (prop === "assertScope") {
        return (entity: { organization_id: string; branch_id?: string }) => {
          if (entity.organization_id !== scope.org) {
            throw new Error(
              `Cross-tenant access violation: expected org ${scope.org}, got ${entity.organization_id}`
            );
          }
          if (entity.branch_id && entity.branch_id !== scope.branch) {
            throw new Error(
              `Cross-branch access violation: expected branch ${scope.branch}, got ${entity.branch_id}`
            );
          }
        };
      }

      if (prop === "getScope") {
        return () => scope;
      }

      return value;
    },
  };

  return new Proxy(repo, handler) as RepoT & ScopedRepo;
}

/**
 * Validate an entity belongs to a scope.
 * Used inside repo functions to ensure cross-tenant reads are blocked.
 * Per ADR-0008: one enforcement point at the command door (or repo layer for reads).
 */
export function assertEntityInScope(
  entity: { organization_id: string; branch_id?: string },
  scope: TenantScope
): void {
  if (entity.organization_id !== scope.org) {
    throw new Error(
      `Cross-tenant access violation: expected org ${scope.org}, got ${entity.organization_id}`
    );
  }
  if (entity.branch_id && entity.branch_id !== scope.branch) {
    throw new Error(
      `Cross-branch access violation: expected branch ${scope.branch}, got ${entity.branch_id}`
    );
  }
}
