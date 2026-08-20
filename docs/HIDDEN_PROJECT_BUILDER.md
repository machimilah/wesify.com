# BO hidden project builder

BO now uses a hybrid architecture:

1. Business intelligence compiles onboarding into a structured workspace specification.
2. The hidden project builder turns that specification into an internal, versioned source project.
3. The business operating agent uses the promoted project action registry and tenant-scoped data APIs.

The app name and customer-facing product remain **BO**. Source files, build tools, migrations, test output, and project infrastructure are not exposed in the normal interface.

## Generated project structure

Runtime projects are written beneath `generated-projects/{workspaceId}/` and excluded from source control:

```text
current.json
history.json
data.json
versions/
  v1/
    app/pages/
    services/
    workflows/
    database/schema.json
    database/migrations/
    tests/self-test.mjs
    runtime.mjs
    project.json
```

Every version contains a machine-readable manifest with pages, entities, relationships, workflows, metrics, permissions, generated files, specialized components, action registry, previous version, change description, and health state.

## Build lifecycle

Initial builds use:

```text
Business Profile → Workspace Specification → Generated Files → Syntax Checks → Runtime Self-Test → Promote → Mount
```

Structural changes use:

```text
Inspect Current Manifest → Plan Change → Build Candidate → Test → Repair Once If Needed → Real Candidate Preview → Apply → Promote
```

The current pointer is unchanged while a candidate builds. A failed candidate cannot replace the operating workspace. Promoted versions can be restored through the business-language “Undo last change” control.

## Same-domain runtime and data

The Vite development shell proxies `/api` to the hidden project service. Production uses the same server to serve the compiled BO shell and APIs. Generated runtime modules are fetched through the tenant boundary and mounted directly in the BO application; no iframe or external generated-app domain is used.

The project API provides:

- idempotent initial builds;
- tested change candidates and explicit promotion;
- manifest and version history;
- runtime module delivery;
- schema-validated CRUD with relationship checks;
- generated action registry;
- server-side workspace scoping;
- simplified server-side role checks;
- workflow-triggered notifications;
- cross-module project-cost queries;
- rollback to a previously healthy version.

## Commands

```text
npm run dev                  # BO shell + hidden project service
npm run build                # frontend production build
npm start                    # serve production shell + project APIs
npm test                     # source unit tests
npm run test:project-service # isolated codegen/backend/versioning test
npm run test:smoke           # full browser journey
```

## MVP boundary

This vertical slice proves prompt → generated project → mounted business app → persisted business data → tested source modification → promoted updated app.

Before hosting real multi-company data, BO still needs authenticated server sessions, a production database/object store, durable job queue, hardened build sandbox/container isolation, secrets management, rate limiting, audit persistence, and full security review. Header-based local role/workspace context is an MVP boundary, not production authentication.
