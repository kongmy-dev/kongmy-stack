/**
 * .dependency-cruiser.cjs — Boundary enforcement (ADR-0001)
 *
 * Encodes the allowed-imports table: contract/core/db/apps layering.
 * Compile error if violated; keeps the import graph honest without base classes.
 */

module.exports = {
  forbidden: [
    {
      name: 'packages-never-import-apps',
      comment:
        'Packages (contract, core, db) are app-agnostic. Must never import from apps/* (top layer).',
      severity: 'error',
      from: {
        path: '^packages',
      },
      to: {
        path: '^apps',
      },
    },
    {
      name: 'no-unresolvable',
      comment:
        'Imports must resolve. Without this, a typo’d path silently produces no edge and evades every layering rule (tsc also catches it; this keeps the boundary check self-sufficient).',
      severity: 'error',
      from: {},
      to: {
        couldNotResolve: true,
      },
    },
    {
      name: 'contract-only-zod',
      comment:
        'packages/contract imports only zod. Never the OpenAPI adapter.',
      severity: 'error',
      from: {
        path: '^packages/contract/src',
      },
      to: {
        path: '^(?!node_modules/zod|packages/contract)',
      },
    },
    {
      name: 'core-no-db-hono',
      comment:
        'packages/core is pure domain. No db, hono, I/O, or runtime APIs.',
      severity: 'error',
      from: {
        path: '^packages/core/src',
      },
      to: {
        path: '^(packages/db|node_modules/hono)',
      },
    },
    {
      name: 'db-no-hono-apps',
      comment: 'packages/db never imports apps or hono.',
      severity: 'error',
      from: {
        path: '^packages/db/src',
      },
      to: {
        path: '^(apps|node_modules/hono)',
      },
    },
    {
      name: 'api-routes-no-db-repos',
      comment: 'API routes import contract and services, never db repos directly.',
      severity: 'error',
      from: {
        path: '^apps/api/src/routes',
      },
      to: {
        path: '^packages/db/src',
      },
    },
    {
      name: 'services-no-hono',
      comment:
        'Services never see hono.Context. Keeps them transport-agnostic.',
      severity: 'error',
      from: {
        path: '^apps/api/src/services',
      },
      to: {
        path: '^node_modules/hono',
      },
    },
  ],
  options: {
    doNotFollow: 'node_modules',
    includeOnly: '^(packages|apps|scripts|\\.)',
  },
};
