# ADR 0002: Modular monolith instead of microservices

**Status:** Accepted

## Context
"Enterprise-grade" invites microservices. The app has a handful of bounded contexts (catalog, inventory, orders, payments, importing), one team, one database, and a reviewer who must be able to run it with one command.

## Decision
Build one deployable unit, organized by domain modules with enforced boundaries:

```
api  →  orders | importing  →  inventory  →  catalog  →  payments | events  →  core
```

`import-linter` contracts run in CI and fail the build if:
- a lower layer imports a higher one;
- `payments` imports any domain module; or
- `events` (the transport) imports any domain module.

## Consequences
- ACID transactions are available where money and stock live. There are no distributed transactions to coordinate.
- One image is simple to run, debug and review.
- Boundaries are real rather than just folders. Extracting `payments` or `inventory` later is mechanical: their only entry points are service functions and events.
- **Processes are already separate.** The API (`uvicorn app.main:app`) and the worker (`python -m app.worker`: outbox dispatchers and reconciler) run from the same codebase and image.
  - By default they're two containers, and the worker scales by replicas because each process uses one CPU core ([ADR 0003](0003-checkout-saga-and-outbox.md)).
  - With the worker stopped, the API keeps working while events wait in the outbox.
- **The data is not separated yet** (one database, one schema, and some foreign keys that cross modules), so these are not independently deployable services. [`architecture.md` section 6](../architecture.md#6-from-modular-monolith-to-services) lists every coupling to break, its resolution, and the extraction order (payments → importing → inventory).
- The API scales as one unit, which is acceptable at this size; background delivery already scales on its own. The scaling path is documented in [`docs/evolution.md`](../evolution.md).

## Alternatives considered
- **Microservices from day one:** this would trade ACID for eventual consistency and add a broker, service discovery and distributed tracing, with no problem that requires them yet.
- **Layered-by-technical-concern (`models/`, `services/`, `routes/`):** simpler at first, but it hides domain boundaries and makes later extraction harder.

## Architecture alternative considered: PrestaShop
Building on PrestaShop, an off-the-shelf open-source e-commerce platform, gets a shop running fast, but its architecture comes with it:
- **MySQL, not PostgreSQL.** This design relies on Postgres features: `pg_trgm` and `tsvector` search, transactional migrations, and triggers that keep the stock ledger append-only.
- **A classic monolith, not a modular one.** It's one PHP application over one shared schema. Modules extend it through hooks and class overrides and can read or write any table, so module boundaries are not enforced.
- **Higher throughput later means scaling the whole thing.** The usual path is cloning the entire application behind a load balancer on top of one shared MySQL. There is no outbox or separate worker process to take background work off the request path, and no seams along which to extract a service.
- **Inherited technical debt.** The platform is part-way through migrating from its legacy core to Symfony, so two architectures live side by side. Customizations built as overrides tend to break on upgrades, which ties the shop to the platform's release cycle.

For a merchant with standard needs, buying a platform is often the right call. Here the goal is an architecture that can grow (enforced modules, separable processes, an extraction path to services), and starting from PrestaShop would mean inheriting the debt this ADR avoids.
