import { IDEMPOTENCY_ERROR_CODES, IdempotencyError } from "./errors.mjs";

export const PRODUCTION_STATES = Object.freeze({
    PENDING_APPROVAL: "PENDING_APPROVAL",
    SUBMITTING: "SUBMITTING",
    SUBMITTED: "SUBMITTED",
    IN_PRODUCTION: "IN_PRODUCTION",
    SHIPPED: "SHIPPED",
    SUBMISSION_UNKNOWN: "SUBMISSION_UNKNOWN",
    FAILED_BEFORE_ACCEPTANCE: "FAILED_BEFORE_ACCEPTANCE",
    ACTION_REQUIRED: "ACTION_REQUIRED",
    CANCELLED: "CANCELLED",
});

const TRANSITIONS = Object.freeze({
    [PRODUCTION_STATES.PENDING_APPROVAL]: new Set([
        PRODUCTION_STATES.SUBMITTING,
        PRODUCTION_STATES.ACTION_REQUIRED,
        PRODUCTION_STATES.CANCELLED,
    ]),
    [PRODUCTION_STATES.SUBMITTING]: new Set([
        PRODUCTION_STATES.SUBMITTED,
        PRODUCTION_STATES.SUBMISSION_UNKNOWN,
        PRODUCTION_STATES.FAILED_BEFORE_ACCEPTANCE,
        PRODUCTION_STATES.ACTION_REQUIRED,
    ]),
    [PRODUCTION_STATES.SUBMITTED]: new Set([
        PRODUCTION_STATES.IN_PRODUCTION,
        PRODUCTION_STATES.ACTION_REQUIRED,
    ]),
    [PRODUCTION_STATES.IN_PRODUCTION]: new Set([
        PRODUCTION_STATES.SHIPPED,
        PRODUCTION_STATES.ACTION_REQUIRED,
    ]),
    [PRODUCTION_STATES.SHIPPED]: new Set([]),
    [PRODUCTION_STATES.SUBMISSION_UNKNOWN]: new Set([
        PRODUCTION_STATES.SUBMITTED,
        PRODUCTION_STATES.FAILED_BEFORE_ACCEPTANCE,
        PRODUCTION_STATES.ACTION_REQUIRED,
    ]),
    [PRODUCTION_STATES.FAILED_BEFORE_ACCEPTANCE]: new Set([
        PRODUCTION_STATES.SUBMITTING,
        PRODUCTION_STATES.ACTION_REQUIRED,
        PRODUCTION_STATES.CANCELLED,
    ]),
    [PRODUCTION_STATES.ACTION_REQUIRED]: new Set([
        PRODUCTION_STATES.CANCELLED,
    ]),
    [PRODUCTION_STATES.CANCELLED]: new Set([]),
});

export function assertPositiveQuantity(quantity) {
    if (!Number.isInteger(quantity) || quantity < 1) {
        throw new IdempotencyError(
            IDEMPOTENCY_ERROR_CODES.INVALID_QUANTITY,
            "Shopify fulfillment order line quantity must be a positive integer.",
        );
    }
    return quantity;
}

export function assertTransitionAllowed(fromState, toState) {
    if (!TRANSITIONS[fromState]?.has(toState)) {
        throw new IdempotencyError(
            IDEMPOTENCY_ERROR_CODES.INVALID_STATE_TRANSITION,
            `Production state cannot transition from ${fromState} to ${toState}.`,
        );
    }
}

export function assertSubmissionEligible(state) {
    const blocked = {
        [PRODUCTION_STATES.SUBMITTED]: IDEMPOTENCY_ERROR_CODES.ALREADY_SUBMITTED,
        [PRODUCTION_STATES.IN_PRODUCTION]: IDEMPOTENCY_ERROR_CODES.ALREADY_IN_PRODUCTION,
        [PRODUCTION_STATES.SHIPPED]: IDEMPOTENCY_ERROR_CODES.ALREADY_SHIPPED,
        [PRODUCTION_STATES.CANCELLED]: IDEMPOTENCY_ERROR_CODES.CANCELLED_NOT_PRODUCIBLE,
        [PRODUCTION_STATES.SUBMITTING]: IDEMPOTENCY_ERROR_CODES.SUBMISSION_IN_PROGRESS,
        [PRODUCTION_STATES.SUBMISSION_UNKNOWN]: IDEMPOTENCY_ERROR_CODES.SUBMISSION_UNKNOWN_REQUIRES_RECONCILIATION,
    };
    const code = blocked[state];
    if (code) throw new IdempotencyError(code, `Fresh production submission is blocked while state is ${state}.`);
    if (![PRODUCTION_STATES.PENDING_APPROVAL, PRODUCTION_STATES.FAILED_BEFORE_ACCEPTANCE].includes(state)) {
        throw new IdempotencyError(
            IDEMPOTENCY_ERROR_CODES.INVALID_STATE_TRANSITION,
            `State ${state} is not eligible for production submission.`,
        );
    }
}

export function createRecord(input, references, now) {
    assertPositiveQuantity(input.quantity);
    return {
        canonical_key: references.canonicalKey,
        provider_scope: input.providerScope,
        shopify_order_id: input.shopifyOrderId,
        shopify_line_item_id: input.shopifyLineItemId,
        shopify_fulfillment_order_id: input.shopifyFulfillmentOrderId,
        shopify_fulfillment_order_line_item_id: input.shopifyFulfillmentOrderLineItemId,
        shopify_variant_id: input.shopifyVariantId,
        quantity: input.quantity,
        gelato_order_reference_id: references.orderReferenceId,
        gelato_item_reference_id: references.itemReferenceId,
        gelato_order_id: null,
        state: PRODUCTION_STATES.PENDING_APPROVAL,
        attempt_count: 0,
        last_error_code: null,
        last_error_message: null,
        cancellation_state: "NOT_CANCELLED",
        financial_status: input.financialStatus ?? "NOT_MODELED",
        actor: input.actor,
        created_at: now,
        updated_at: now,
        submitted_at: null,
        reconciled_at: null,
    };
}
