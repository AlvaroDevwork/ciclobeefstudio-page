# Production idempotency guard

This module is a server-side domain contract for a future controlled production-submission boundary. It does not replace the installed Gelato Shopify app, call Gelato, process Shopify webhooks, or enable production submission. `REAL_GELATO_SUBMISSION_ENABLED` is deliberately `false`.

## Canonical identity and references

The canonical key is the Shopify fulfillment order GID plus the fulfillment order line-item GID:

```text
gid://shopify/FulfillmentOrder/{id}
+
gid://shopify/FulfillmentOrderLineItem/{id}
```

Product, variant, cart, order name, browser session, local storage, and checkout URL are not production identities. The Gelato-style `orderReferenceId` and `itemReferenceId` are deterministic SHA-256-derived representations of the fulfillment order and fulfillment line identities. A retry therefore cannot generate a new provider reference. The source Shopify GIDs remain on the persistent record for audit and reconciliation.

Quantity comes only from the Shopify fulfillment order line item and must be a positive integer. It is copied unchanged into a provider request; attempt count, callback count, and approval count never affect it.

## State and retry rules

The normal state flow is:

```text
PENDING_APPROVAL -> SUBMITTING -> SUBMITTED -> IN_PRODUCTION -> SHIPPED
```

Recovery states are `SUBMISSION_UNKNOWN`, `FAILED_BEFORE_ACCEPTANCE`, `ACTION_REQUIRED`, and `CANCELLED`. Transitions are allow-listed. `SUBMITTED`, `IN_PRODUCTION`, `SHIPPED`, and `CANCELLED` reject fresh submission. `SUBMITTING` is an atomic compare-and-set lock, so concurrent approval requests have one winner.

An unknown response transitions to `SUBMISSION_UNKNOWN`. That state cannot submit again. The service must query the provider using the same deterministic `orderReferenceId`, then select the exact `itemReferenceId`:

- found: persist the provider order ID and transition to `SUBMITTED`;
- confirmed absent: transition to `FAILED_BEFORE_ACCEPTANCE`, where a controlled retry is eligible;
- lookup failure: remain `SUBMISSION_UNKNOWN` and require intervention.

This reconciliation-first rule prevents a timeout after provider acceptance from multiplying production. Operations are scoped to one fulfillment line and one provider responsibility, so retrying a Gelato line does not resubmit successful lines or DSers, CJdropshipping, or manual fulfillment lines.

## Cancellation, refunds, and audit

Pre-production `PENDING_APPROVAL`, `FAILED_BEFORE_ACCEPTANCE`, or `ACTION_REQUIRED` records can be explicitly cancelled. `CANCELLED` cannot submit. Cancellation after submission or production is intentionally outside this pre-production guard.

Financial status is recorded independently. A refund neither authorizes production nor implicitly marks provider production cancelled; those require explicit production-state decisions.

Every registration, submission, reconciliation, cancellation, and provider-status transition emits structured audit metadata containing the canonical key, before/after states, attempt number, actor, timestamp, operation, result, error classification, provider references, provider order ID, and quantity. Secrets and customer PII are excluded.

## Persistence and provider boundaries

`IdempotencyRepository` defines the required persistent operations: atomic `createIfAbsent`, compare-and-set state transition, provider identity storage, attempt increment, cancellation, lookup, and audit recording. `InMemoryIdempotencyRepository` is a deterministic reference/test adapter with snapshot rehydration. It is not a production datastore.

```text
PRODUCTION_PERSISTENCE_BACKEND=NOT_YET_SELECTED
```

A production repository must preserve the same uniqueness and compare-and-set semantics across processes. `ProviderReconciliationGateway` defines submission, external-reference lookup, and status lookup. Only `FakeGelatoProvider` exists; a live Gelato adapter is intentionally absent.

Before a future integration is enabled, operators must use an atomic approval action, reject records already processing or beyond submission, reconcile unknown outcomes before retry, and scope recovery to the failed fulfillment line. The current live Gelato approval mode remains externally unverified and must be validated separately in Stage 11.6-R3.
