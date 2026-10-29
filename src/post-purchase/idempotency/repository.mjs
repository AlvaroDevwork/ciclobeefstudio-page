import { IDEMPOTENCY_ERROR_CODES, IdempotencyError } from "./errors.mjs";
import { PRODUCTION_STATES, assertPositiveQuantity, assertTransitionAllowed } from "./model.mjs";
import { createProviderReferences } from "./references.mjs";

export const PRODUCTION_PERSISTENCE_BACKEND = "NOT_YET_SELECTED";

function clone(value) {
    return structuredClone(value);
}

const IMMUTABLE_RECORD_FIELDS = Object.freeze([
    "canonical_key",
    "provider_scope",
    "shopify_order_id",
    "shopify_line_item_id",
    "shopify_fulfillment_order_id",
    "shopify_fulfillment_order_line_item_id",
    "shopify_variant_id",
    "quantity",
    "gelato_order_reference_id",
    "gelato_item_reference_id",
    "created_at",
]);

function assertImmutablePatch(current, patch) {
    const changedField = IMMUTABLE_RECORD_FIELDS.find(field => (
        Object.hasOwn(patch, field) && patch[field] !== current[field]
    ));
    if (changedField) {
        throw new IdempotencyError(
            IDEMPOTENCY_ERROR_CODES.INVALID_STATE_TRANSITION,
            `Atomic transition cannot modify immutable field ${changedField}.`,
        );
    }
}

function corruptPersistedRecord(message, options = {}) {
    return new IdempotencyError(
        IDEMPOTENCY_ERROR_CODES.CORRUPT_PERSISTED_RECORD,
        message,
        options,
    );
}

function requirePersistedString(record, field) {
    if (typeof record?.[field] !== "string" || !record[field]) {
        throw corruptPersistedRecord(`Persisted idempotency record requires ${field}.`);
    }
    return record[field];
}

function validatePersistedRecord(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw corruptPersistedRecord("Persisted idempotency record must be an object.");
    }

    const canonicalKey = requirePersistedString(record, "canonical_key");
    requirePersistedString(record, "provider_scope");
    requirePersistedString(record, "shopify_order_id");
    requirePersistedString(record, "shopify_line_item_id");
    const fulfillmentOrderId = requirePersistedString(record, "shopify_fulfillment_order_id");
    const fulfillmentLineId = requirePersistedString(record, "shopify_fulfillment_order_line_item_id");
    requirePersistedString(record, "shopify_variant_id");
    requirePersistedString(record, "gelato_order_reference_id");
    requirePersistedString(record, "gelato_item_reference_id");
    requirePersistedString(record, "state");
    const createdAt = requirePersistedString(record, "created_at");

    try {
        assertPositiveQuantity(record.quantity);
        const references = createProviderReferences(fulfillmentOrderId, fulfillmentLineId);
        if (canonicalKey !== references.canonicalKey) {
            throw corruptPersistedRecord("Persisted canonical key does not match the Shopify fulfillment identity.");
        }
        if (record.gelato_order_reference_id !== references.orderReferenceId) {
            throw corruptPersistedRecord("Persisted provider order reference is not deterministic.");
        }
        if (record.gelato_item_reference_id !== references.itemReferenceId) {
            throw corruptPersistedRecord("Persisted provider item reference is not deterministic.");
        }
    } catch (error) {
        if (error instanceof IdempotencyError && error.code === IDEMPOTENCY_ERROR_CODES.CORRUPT_PERSISTED_RECORD) {
            throw error;
        }
        throw corruptPersistedRecord("Persisted fulfillment identity or quantity is invalid.", { cause: error });
    }

    if (!Object.values(PRODUCTION_STATES).includes(record.state)) {
        throw corruptPersistedRecord(`Persisted production state ${record.state} is unknown.`);
    }
    if (Number.isNaN(Date.parse(createdAt))) {
        throw corruptPersistedRecord("Persisted created_at timestamp is invalid.");
    }

    return record;
}

export class IdempotencyRepository {
    async getByCanonicalKey() { throw new Error("getByCanonicalKey must be implemented."); }
    async createIfAbsent() { throw new Error("createIfAbsent must be implemented."); }
    async compareAndTransitionState() { throw new Error("compareAndTransitionState must be implemented."); }
    async saveProviderIdentity() { throw new Error("saveProviderIdentity must be implemented."); }
    async incrementAttempt() { throw new Error("incrementAttempt must be implemented."); }
    async recordAuditEvent() { throw new Error("recordAuditEvent must be implemented."); }
    async markCancelled() { throw new Error("markCancelled must be implemented."); }
}

export class InMemoryIdempotencyRepository extends IdempotencyRepository {
    #records = new Map();
    #auditEvents = [];
    #sequence = 0;

    constructor(snapshot) {
        super();
        let records = [];
        if (snapshot != null) {
            if (typeof snapshot !== "object" || Array.isArray(snapshot) || !Object.hasOwn(snapshot, "records")) {
                throw corruptPersistedRecord("Persisted idempotency snapshot requires a records array.");
            }
            records = snapshot.records;
        }
        if (!Array.isArray(records)) {
            throw corruptPersistedRecord("Persisted idempotency records must be an array.");
        }
        for (const record of records) {
            validatePersistedRecord(record);
            if (this.#records.has(record.canonical_key)) {
                throw corruptPersistedRecord(`Persisted canonical key ${record.canonical_key} is duplicated.`);
            }
            this.#records.set(record.canonical_key, clone(record));
        }
        this.#auditEvents = clone(snapshot?.auditEvents ?? []);
        this.#sequence = snapshot?.sequence ?? this.#auditEvents.length;
    }

    async getByCanonicalKey(canonicalKey) {
        const record = this.#records.get(canonicalKey);
        return record ? clone(record) : null;
    }

    async createIfAbsent(record) {
        const current = this.#records.get(record.canonical_key);
        if (current) return { created: false, record: clone(current) };
        this.#records.set(record.canonical_key, clone(record));
        return { created: true, record: clone(record) };
    }

    async compareAndTransitionState(canonicalKey, expectedStates, nextState, patch = {}) {
        const current = this.#requireRecord(canonicalKey);
        if (!expectedStates.includes(current.state)) return { changed: false, record: clone(current) };
        assertTransitionAllowed(current.state, nextState);
        assertImmutablePatch(current, patch);
        const updated = { ...current, ...clone(patch), state: nextState };
        this.#records.set(canonicalKey, updated);
        return { changed: true, record: clone(updated) };
    }

    async saveProviderIdentity(canonicalKey, providerOrderId, updatedAt) {
        const current = this.#requireRecord(canonicalKey);
        if (current.gelato_order_id && current.gelato_order_id !== providerOrderId) {
            throw new IdempotencyError(
                IDEMPOTENCY_ERROR_CODES.INVALID_STATE_TRANSITION,
                "A canonical fulfillment line cannot be rebound to another provider order.",
            );
        }
        const updated = { ...current, gelato_order_id: providerOrderId, updated_at: updatedAt };
        this.#records.set(canonicalKey, updated);
        return clone(updated);
    }

    async incrementAttempt(canonicalKey, updatedAt) {
        const current = this.#requireRecord(canonicalKey);
        const updated = { ...current, attempt_count: current.attempt_count + 1, updated_at: updatedAt };
        this.#records.set(canonicalKey, updated);
        return clone(updated);
    }

    async recordAuditEvent(event) {
        const stored = { audit_id: ++this.#sequence, ...clone(event) };
        this.#auditEvents.push(stored);
        return clone(stored);
    }

    async markCancelled(canonicalKey, actor, timestamp) {
        const current = this.#requireRecord(canonicalKey);
        const result = await this.compareAndTransitionState(
            canonicalKey,
            [PRODUCTION_STATES.PENDING_APPROVAL, PRODUCTION_STATES.FAILED_BEFORE_ACCEPTANCE, PRODUCTION_STATES.ACTION_REQUIRED],
            PRODUCTION_STATES.CANCELLED,
            { cancellation_state: "CANCELLED", actor, updated_at: timestamp },
        );
        return result;
    }

    async listAuditEvents(canonicalKey) {
        return clone(this.#auditEvents.filter(event => event.canonical_key === canonicalKey));
    }

    snapshot() {
        return clone({
            records: [...this.#records.values()],
            auditEvents: this.#auditEvents,
            sequence: this.#sequence,
        });
    }

    #requireRecord(canonicalKey) {
        const record = this.#records.get(canonicalKey);
        if (!record) {
            throw new IdempotencyError(IDEMPOTENCY_ERROR_CODES.RECORD_NOT_FOUND, `No idempotency record exists for ${canonicalKey}.`);
        }
        return record;
    }
}
