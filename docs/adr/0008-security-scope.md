# ADR 0008: No authentication in this build, with the exposure documented

**Status:** Accepted

## Context
The requirements ask for product CRUD, CSV import, search and a purchase flow, each with a UI, runnable with Docker. Authentication isn't among them, and a reviewer should be able to try every screen without any setup. "Enterprise-grade" and the closing note about foresight still mean the gap has to be visible and deliberate, not discovered. Customer data is the sensitive part of any shop.

## Decision
- No sign-in in this build. Every endpoint and every page is public.
- The README's [Security scope](../../README.md#security-scope) section lists exactly what that exposes:
  - admin actions: product CRUD, imports, and the System page (outbox retries, the reconciler, alerts);
  - every order, with the customer's email, card brand and last 4 digits, on the Orders page and at `GET /api/orders`;
  - sequential order ids, so `GET /api/orders/{id}` can be enumerated;
  - recipient emails in the notification log;
  - import history and issue reports.
- The production design is written down, not built (below).

## Consequences
- A reviewer can try every flow immediately, with no credentials to find.
- The exposure is real, so this build must not be deployed beyond a local demo.
- Adding authentication later is a contained change:
  - `/api/admin` and `/api/imports` are each one router, so one dependency per router protects them;
  - product writes and the orders list share routers with public endpoints, so they take a per-route dependency or move under `/api/admin`;
  - every admin page in the UI lives under `/admin`, so one route guard covers them.
- Card data stays minimal either way: only the brand and the last 4 digits are stored.

## Production design
- **Staff:** OIDC / OAuth 2.0 single sign-on with the company's identity provider (authorization code flow with PKCE). The SPA holds a server-side session in an `HttpOnly`, `Secure`, `SameSite` cookie. Service clients, such as an ERP pushing catalog files, use short-lived JWT access tokens with refresh tokens.
- **Roles:** catalog manager, importer, support, operator and auditor, checked by one FastAPI dependency. A route-inventory test fails if a non-public route has no permission check.
- **Customers:** guest checkout stays. Each order gets an unguessable reference (a UUID), and a lookup needs the reference plus the email. The all-orders list moves into the admin area.
- **Audit and hardening:** an `actor` on ledger rows and import runs, rate limits on sign-in and checkout, CSRF checks for cookie sessions, security headers (CSP, HSTS), secrets from a vault, and a retention policy for customer emails.

## When to build it
Before any deployment beyond a local demo, or before the first real customer data.

## Alternatives considered
| Option | Trade-off |
|---|---|
| Server-side session in a cookie | Recommended for the SPA. Sessions are revocable, and the token never reaches JavaScript. It needs CSRF protection, which `SameSite` plus an `Origin` check provide |
| JWT in `localStorage` | Stateless and simple, but any XSS can read it, and revoking a token before it expires needs a deny list |
| OAuth 2.0 / OIDC with the company's identity provider | The right source of staff identity: single sign-on, MFA and offboarding come from the identity provider. It sits in front of either session style |
| Static API key | Fine for one internal script, but it has no per-user identity, roles or audit trail, so it isn't for people |
| A minimal login built now | Rejected for this build. It adds setup for anyone trying the app and a weak, demo-only security model, without changing anything that was asked for |
