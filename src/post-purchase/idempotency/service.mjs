import { IDEMPOTENCY_ERROR_CODES, IdempotencyError } from "./errors.mjs";
import {
    PRODUCTION_STATES,
    assertPositiveQuantity,
    assertSubmissionEligible,
    createRecord,
} from "./model.mjs";
import { ProviderSubmissionError } from "./provider.mjs";
import { createProviderReferences } from "./references.mjs";

function defaultClock() {
    return new Date().toISOString();
}

function errorPatch(error, now) {
    return {
        last_error_code: error.code ?? "PROVIDER_ERROR",
        last_error_message: error.message,
        updated_at: now,
    };
}

function immutableIdentityMatches(record, input) {
    return record.provider_scope === input.providerScope
        && record.shopify_order_id === input.shopifyOrderId
        && record.shopify_line_item_id === input.shopifyLineItemId
        && record.shopify_fulfillment_order_id === input.shopifyFulfillmentOrderId
        && record.shopify_fulfillment_order_line_item_id === input.shopifyFulfillmentOrderLineItemId
        && record.shopify_variant_id === input.shopifyVariantId
        && record.quantity === input.quantity;
}

export class ProductionIdempotencyService {
    constructor({ repository, provider, providerScope = "GELATO", clock = defaultClock }) {
        if (!repository || !provider) throw new TypeError("Repository and provider are required.");
        this.repository = repository;
        this.provider = provider;
        this.providerScope = providerScope;
        this.clock = clock;
    }

    async registerLine(input) {
        this.#assertProviderScope(input.providerScope);
        assertPositiveQuantity(input.quantity);
        const references = createProviderReferences(
            input.shopifyFulfillmentOrderId,
            input.shopifyFulfillmentOrderLineItemId,
        );
        const now = this.clock();
        const record = createRecord({ ...input, actor: input.actor ?? "SYSTEM" }, references, now);
        const result = await this.repository.createIfAbsent(record);
        if (!immutableIdentityMatches(result.record, input)) {
            const error = new IdempotencyError(
                IDEMPOTENCY_ERROR_CODES.INVALID_STATE_TRANSITION,
                "Existing canonical record does not match the immutable Shopify fulfillment identity.",
            );
            await this.#audit(result.record, {
                stateBefore: result.record.state,
                stateAfter: result.record.state,
                actor: record.actor,
                operationType: "REGISTER_LINE",
                result: "IDENTITY_MISMATCH_REJECTED",
                error,
            });
            throw error;
        }
        if (result.created) {
            await this.#audit(result.record, {
                stateBefore: null,
                stateAfter: result.record.state,
                actor: record.actor,
                operationType: "REGISTER_LINE",
                result: "CREATED",
            });
        }
        return result;
    }

    async approve(input, actor = "OPERATOR") {
        const registration = await this.registerLine({ ...input, actor });
        const current = registration.record;
        try {
            assertSubmissionEligible(current.state);
        } catch (error) {
            await this.#audit(current, {
                stateBefore: current.state,
                stateAfter: current.state,
                actor,
                operationType: "APPROVE_PRODUCTION",
                result: this.#approvalRejectionResult(error.code),
                error,
            });
            throw error;
        }
        const now = this.clock();
        const lock = await this.repository.compareAndTransitionState(
            current.canonical_key,
            [current.state],
            PRODUCTION_STATES.SUBMITTING,
            { actor, updated_at: now, last_error_code: null, last_error_message: null },
        );
        if (!lock.changed) {
            try {
                this.#throwSubmissionGuard(lock.record.state);
            } catch (error) {
                await this.#audit(lock.record, {
                    stateBefore: lock.record.state,
                    stateAfter: lock.record.state,
                    actor,
                    operationType: "APPROVE_PRODUCTION",
                    result: this.#approvalRejectionResult(error.code),
                    error,
                });
                throw error;
            }
        }

        const attempting = await this.repository.incrementAttempt(current.canonical_key, now);
        await this.#audit(attempting, {
            stateBefore: current.state,
            stateAfter: PRODUCTION_STATES.SUBMITTING,
            actor,
            operationType: "SUBMIT_PRODUCTION",
            result: "STARTED",
        });

        const payload = Object.freeze({
            canonicalKey: attempting.canonical_key,
            orderReferenceId: attempting.gelato_order_reference_id,
            itemReferenceId: attempting.gelato_item_reference_id,
            quantity: attempting.quantity,
            shopifyFulfillmentOrderId: attempting.shopify_fulfillment_order_id,
            shopifyFulfillmentOrderLineItemId: attempting.shopify_fulfillment_order_line_item_id,
            shopifyVariantId: attempting.shopify_variant_id,
        });

        try {
            const providerOrder = await this.provider.submitProduction(payload);
            await this.repository.saveProviderIdentity(current.canonical_key, providerOrder.providerOrderId, this.clock());
            const submittedAt = this.clock();
            const transition = await this.repository.compareAndTransitionState(
                current.canonical_key,
                [PRODUCTION_STATES.SUBMITTING],
                PRODUCTION_STATES.SUBMITTED,
                { submitted_at: submittedAt, updated_at: submittedAt },
            );
            await this.#audit(transition.record, {
                stateBefore: PRODUCTION_STATES.SUBMITTING,
                stateAfter: PRODUCTION_STATES.SUBMITTED,
                actor,
                operationType: "SUBMIT_PRODUCTION",
                result: "ACCEPTED",
            });
            return transition.record;
        } catch (error) {
            const unknown = !(error instanceof ProviderSubmissionError) || error.acceptanceUnknown;
            const nextState = unknown
                ? PRODUCTION_STATES.SUBMISSION_UNKNOWN
                : PRODUCTION_STATES.FAILED_BEFORE_ACCEPTANCE;
            const transition = await this.repository.compareAndTransitionState(
                current.canonical_key,
                [PRODUCTION_STATES.SUBMITTING],
                nextState,
                errorPatch(error, this.clock()),
            );
            await this.#audit(transition.record, {
                stateBefore: PRODUCTION_STATES.SUBMITTING,
                stateAfter: nextState,
                actor,
                operationType: "SUBMIT_PRODUCTION",
                result: unknown ? "UNKNOWN" : "REJECTED_BEFORE_ACCEPTANCE",
                error,
            });
            return transition.record;
        }
    }

    async reconcile(canonicalKey, actor = "RECONCILER") {
        const current = await this.#requireRecord(canonicalKey);
        if (current.state !== PRODUCTION_STATES.SUBMISSION_UNKNOWN) {
            const error = new IdempotencyError(
                IDEMPOTENCY_ERROR_CODES.INVALID_STATE_TRANSITION,
                "Provider reconciliation is only valid from SUBMISSION_UNKNOWN.",
            );
            await this.#audit(current, {
                stateBefore: current.state,
                stateAfter: current.state,
                actor,
                operationType: "RECONCILE_PROVIDER",
                result: "INVALID_STATE_TRANSITION",
                error,
            });
            throw error;
        }
        try {
            const providerOrder = await this.provider.findOrderByReference(
                current.gelato_order_reference_id,
                current.gelato_item_reference_id,
            );
            const now = this.clock();
            if (providerOrder) {
                if (
                    providerOrder.orderReferenceId !== current.gelato_order_reference_id
                    || providerOrder.itemReferenceId !== current.gelato_item_reference_id
                    || providerOrder.quantity !== current.quantity
                ) {
                    throw new IdempotencyError(
                        IDEMPOTENCY_ERROR_CODES.PROVIDER_RECONCILIATION_FAILED,
                        "Provider order, item identity, or quantity differs from the canonical fulfillment line.",
                    );
                }
                await this.repository.saveProviderIdentity(canonicalKey, providerOrder.providerOrderId, now);
                const result = await this.repository.compareAndTransitionState(
                    canonicalKey,
                    [PRODUCTION_STATES.SUBMISSION_UNKNOWN],
                    PRODUCTION_STATES.SUBMITTED,
                    { reconciled_at: now, submitted_at: now, updated_at: now },
                );
                await this.#audit(result.record, {
                    stateBefore: PRODUCTION_STATES.SUBMISSION_UNKNOWN,
                    stateAfter: PRODUCTION_STATES.SUBMITTED,
                    actor,
                    operationType: "RECONCILE_PROVIDER",
                    result: "FOUND",
                });
                return result.record;
            }
            const result = await this.repository.compareAndTransitionState(
                canonicalKey,
                [PRODUCTION_STATES.SUBMISSION_UNKNOWN],
                PRODUCTION_STATES.FAILED_BEFORE_ACCEPTANCE,
                { reconciled_at: now, updated_at: now },
            );
            await this.#audit(result.record, {
                stateBefore: PRODUCTION_STATES.SUBMISSION_UNKNOWN,
                stateAfter: PRODUCTION_STATES.FAILED_BEFORE_ACCEPTANCE,
                actor,
                operationType: "RECONCILE_PROVIDER",
                result: "NOT_FOUND",
            });
            return result.record;
        } catch (error) {
            const latest = await this.#requireRecord(canonicalKey);
            await this.#audit(latest, {
                stateBefore: latest.state,
                stateAfter: latest.state,
                actor,
                operationType: "RECONCILE_PROVIDER",
                result: error instanceof IdempotencyError ? "RECONCILIATION_REJECTED" : "LOOKUP_FAILED",
                error,
            });
            if (error instanceof IdempotencyError) throw error;
            throw new IdempotencyError(
                IDEMPOTENCY_ERROR_CODES.PROVIDER_RECONCILIATION_FAILED,
                "Provider lookup failed; the line remains SUBMISSION_UNKNOWN and cannot be retried.",
                { cause: error },
            );
        }
    }

    async cancel(canonicalKey, actor = "OPERATOR") {
        const before = await this.#requireRecord(canonicalKey);
        const result = await this.repository.markCancelled(canonicalKey, actor, this.clock());
        if (!result.changed) {
            const error = new IdempotencyError(
                IDEMPOTENCY_ERROR_CODES.INVALID_STATE_TRANSITION,
                `State ${before.state} cannot be cancelled as a pre-production line.`,
            );
            await this.#audit(result.record, {
                stateBefore: result.record.state,
                stateAfter: result.record.state,
                actor,
                operationType: "CANCEL_PRODUCTION",
                result: this.#cancellationRejectionResult(result.record.state),
                error,
            });
            throw error;
        }
        await this.#audit(result.record, {
            stateBefore: before.state,
            stateAfter: PRODUCTION_STATES.CANCELLED,
            actor,
            operationType: "CANCEL_PRODUCTION",
            result: "CANCELLED",
        });
        return result.record;
    }

    async markInProduction(canonicalKey, actor = "PROVIDER_STATUS") {
        return this.#transition(canonicalKey, PRODUCTION_STATES.SUBMITTED, PRODUCTION_STATES.IN_PRODUCTION, actor, "MARK_IN_PRODUCTION");
    }

    async markShipped(canonicalKey, actor = "PROVIDER_STATUS") {
        return this.#transition(canonicalKey, PRODUCTION_STATES.IN_PRODUCTION, PRODUCTION_STATES.SHIPPED, actor, "MARK_SHIPPED");
    }

    async #transition(canonicalKey, expected, next, actor, operationType) {
        const result = await this.repository.compareAndTransitionState(
            canonicalKey,
            [expected],
            next,
            { actor, updated_at: this.clock() },
        );
        if (!result.changed) {
            const error = new IdempotencyError(
                IDEMPOTENCY_ERROR_CODES.INVALID_STATE_TRANSITION,
                `Expected ${expected}, received ${result.record.state}.`,
            );
            await this.#audit(result.record, {
                stateBefore: result.record.state,
                stateAfter: result.record.state,
                actor,
                operationType,
                result: "INVALID_STATE_TRANSITION",
                error,
            });
            throw error;
        }
        await this.#audit(result.record, {
            stateBefore: expected,
            stateAfter: next,
            actor,
            operationType,
            result: "APPLIED",
        });
        return result.record;
    }

    async #requireRecord(canonicalKey) {
        const record = await this.repository.getByCanonicalKey(canonicalKey);
        if (!record) throw new IdempotencyError(IDEMPOTENCY_ERROR_CODES.RECORD_NOT_FOUND, "Canonical record was not found.");
        return record;
    }

    #assertProviderScope(providerScope) {
        if (providerScope !== this.providerScope) {
            throw new IdempotencyError(
                IDEMPOTENCY_ERROR_CODES.PROVIDER_SCOPE_MISMATCH,
                `This service only owns ${this.providerScope} fulfillment lines.`,
            );
        }
    }

    #throwSubmissionGuard(state) {
        assertSubmissionEligible(state);
        throw new IdempotencyError(IDEMPOTENCY_ERROR_CODES.SUBMISSION_IN_PROGRESS, "Another approval acquired the submission lock.");
    }

    #approvalRejectionResult(code) {
        const results = {
            [IDEMPOTENCY_ERROR_CODES.ALREADY_SUBMITTED]: "SECOND_APPROVAL_REJECTED",
            [IDEMPOTENCY_ERROR_CODES.SUBMISSION_IN_PROGRESS]: "SUBMISSION_IN_PROGRESS_REJECTED",
            [IDEMPOTENCY_ERROR_CODES.SUBMISSION_UNKNOWN_REQUIRES_RECONCILIATION]: "SUBMISSION_UNKNOWN_REJECTED",
            [IDEMPOTENCY_ERROR_CODES.ALREADY_IN_PRODUCTION]: "IN_PRODUCTION_APPROVAL_REJECTED",
            [IDEMPOTENCY_ERROR_CODES.ALREADY_SHIPPED]: "SHIPPED_APPROVAL_REJECTED",
            [IDEMPOTENCY_ERROR_CODES.CANCELLED_NOT_PRODUCIBLE]: "CANCELLED_APPROVAL_REJECTED",
            [IDEMPOTENCY_ERROR_CODES.INVALID_STATE_TRANSITION]: "INVALID_STATE_TRANSITION",
        };
        return results[code] ?? "APPROVAL_REJECTED";
    }

    #cancellationRejectionResult(state) {
        const results = {
            [PRODUCTION_STATES.SUBMITTED]: "CANCEL_AFTER_SUBMITTED_REJECTED",
            [PRODUCTION_STATES.IN_PRODUCTION]: "CANCEL_AFTER_IN_PRODUCTION_REJECTED",
        };
        return results[state] ?? "CANCEL_INVALID_STATE_REJECTED";
    }

    async #audit(record, { stateBefore, stateAfter, actor, operationType, result, error }) {
        return this.repository.recordAuditEvent({
            canonical_key: record.canonical_key,
            state_before: stateBefore,
            state_after: stateAfter,
            attempt_number: record.attempt_count,
            actor,
            timestamp: this.clock(),
            operation_type: operationType,
            result,
            error_code: error?.code ?? null,
            error_message: error?.message ?? null,
            provider_reference: record.gelato_order_reference_id,
            provider_item_reference: record.gelato_item_reference_id,
            provider_order_id: record.gelato_order_id,
            quantity: record.quantity,
        });
    }
}
