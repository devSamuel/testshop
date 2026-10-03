# ADR 0003: In-process checkout saga with a transactional outbox, not a message broker

**Status:** Accepted

## Context
Checkout spans our database and an external payment provider. One ACID transaction cannot include the provider, and holding database locks during a network call blocks other buyers. Side effects (notifications, low-stock alerts, future integrations) must never be lost and never fire for a rolled-back change.

## Decision
**Orchestrated saga, in process:**
1. **Reserve (tx 1).** Insert the order (`pending_payment`, `reservation_expires_at`). Reserve stock with a conditional `UPDATE`, writing ledger rows and outbox events.
2. **Charge.** No transaction is open. The call has a timeout of about 3 s, and the order id is the provider's idempotency key.
3. **Settle or compensate (tx 2).** `paid` commits the reservations. A decline sets `payment_failed` and releases the stock.
4. **Reconciler.** It periodically asks the provider about orders left `pending_payment`, settles them, and expires reservations that were never charged.

Every state transition is `UPDATE … WHERE status = 'pending_payment'`, so exactly one actor wins any race. A successful charge on an order that has already expired raises `RefundRequired` instead of silently keeping the money.

**Transactional outbox:** events are inserted in the same transaction as the change. Dispatcher workers (4 per process by default) deliver them to registered handlers:
- each worker claims a batch with `FOR UPDATE SKIP LOCKED`;
- each event runs in its own **savepoint**, so one failing event never blocks the others;
- failures retry with exponential backoff, then dead-letter;
- batches are processed in aggregate order, and the low-stock handler takes a per-product advisory lock, so parallel workers cannot race to a stale alert.

An inbox table (`processed_events`) makes each handler idempotent.

**Where the workers run: their own polling container.** The dispatchers and the reconciler run in a separate `worker` container (`python -m app.worker`). It only polls Postgres and serves no HTTP. The API process never runs them. The reason is CPU:
- **One event loop is one thread, so at most one core.** The 4 workers are asyncio tasks on one event loop. They overlap waits on Postgres, but they never run Python in parallel. The GIL is why threads in the same process wouldn't change that.
- **Inside the API they competed with checkout.** When the workers ran in the API process (the original default), they shared that one core with HTTP requests, so an event backlog took CPU away from checkout.
- **Separate processes get separate cores.** Each has its own interpreter, GIL and event loop. Scale with `make up WORKERS=N` (`docker compose up --scale worker=N`). This is safe because `SKIP LOCKED` gives each container disjoint batches, and the per-product advisory lock serializes alerts across containers.

Measured with `make drain-bench` (a ~50,000-event backlog; laptop, Docker with 10 CPUs):

| Worker containers | Events/s | vs. 1 container |
|---:|---:|---:|
| 1 | 1,223 | 1.0x |
| 2 | 2,343 | 1.9x |
| 4 | 3,511 | 2.9x |

- **With 1 container,** the worker ran at ~100% CPU (one full core) while Postgres sat at ~25–35%. The event loop is the bottleneck, not the database.
- **With 4 containers,** each still ran at ~100% of a core, and Postgres rose to ~1.6–2.1 cores. Scaling is sublinear (2.9x): each event cost more CPU with four running together. On a laptop VM, cores of different speeds and claim contention are the likely causes. This was not profiled further.

**The in-process option was removed, not kept as a fallback.**
- **One deployment shape.** The API serves endpoints only, and background work has one home.
- **The broker relay will live there.** When events move to a broker, the outbox relay is a focused process in this same container, not something the API also runs.

**What does not help:**
- **Raising `DISPATCHER_WORKERS`:** more tasks on the same core.
- **Threads:** the GIL.
- **Free-threaded Python 3.13t:** it's experimental, and asyncio tasks still share one thread.

## Consequences
- Stock and money are strongly consistent the moment the API responds. Only side effects (alerts, notifications) are eventually consistent, typically within about 1 s.
- Every crash point has a defined recovery. The Hypothesis state machine and `make chaos` exercise them.
- **One more container to run, and more Postgres connections.**
  - Each worker container's pool is capped at 8 (`DB_POOL_SIZE`, no overflow), since it needs at most `DISPATCHER_WORKERS` + 2 connections: the dispatchers, the reconciler's lock connection and one settle session.
  - Together with the API's pool, about 8 worker containers fit under Postgres' default 100 connections. Beyond that, add PgBouncer.
- **One active reconciler, whatever the replica count.**
  - The dispatchers scale with containers, but N reconcilers would ask the payment provider about the same pending orders N times, and a real provider rate-limits.
  - Each tick, `run_once` takes `pg_try_advisory_lock` on its own autocommit connection, so no transaction stays open during provider calls. The replicas that don't get it skip the tick.
  - A crashed holder drops its connection, which releases the lock.
- **Event delivery has its own failure domain.** With the worker stopped, the API keeps taking orders, and their events wait safely in the outbox.
- Broker-ready: handlers do not know how events arrive. Moving to Kafka means adding a relay that publishes outbox rows, and the same handlers run in a consumer.

## Alternatives considered
| Option | Why not (yet) |
|---|---|
| One transaction including the payment call | Holds row locks for seconds and serializes every buyer of a popular product. |
| Fire-and-forget side effects after commit | A crash between commit and send loses the side effect. Sending before commit can notify about an order that never existed. |
| Saga over Kafka/RabbitMQ now | It gives weaker guarantees than the single-database ACID transaction it replaces, and adds operational surface (broker, DLQ, consumer groups, schema versioning) with no current need. The evolution path is documented in [`docs/evolution.md`](../evolution.md). |
| Temporal / workflow engine | An excellent fit when the saga spans many services and needs long timers and visibility. It is overkill for two steps in one process. |

## Before and after the move to a worker container

The move started with a question: *"If we are limited by the GIL, shouldn't the workers be an isolated container that just polls?"*

| | Before | After |
|---|---|---|
| Where delivery runs | 4 asyncio tasks inside the API process | a polling-only `worker` container; the API serves HTTP only |
| CPU | shares one core with checkout requests | one core per worker container |
| How to scale | `DISPATCHER_WORKERS`: more tasks on the same core | `make up WORKERS=N`: more processes, more cores |
| Worker down | not possible separately: it was the API process | the API keeps taking orders; events wait safely in the outbox |
| Evidence | "about 1,400 events/s; the ceiling is Python" | `make drain-bench`: **1,223 → 2,343 → 3,511 events/s** with 1, 2 and 4 containers |
