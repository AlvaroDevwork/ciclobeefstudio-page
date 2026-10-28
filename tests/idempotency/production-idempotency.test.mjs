import assert from "node:assert/strict";
import test from "node:test";

import {
    FAKE_PROVIDER_SCENARIOS,
    IDEMPOTENCY_ERROR_CODES,
    PRODUCTION_PERSISTENCE_BACKEND,
    PRODUCTION_STATES,
    FakeGelatoProvider,
    InMemoryIdempotencyRepository,
    ProviderSubmissionError,
    ProductionIdempotencyService,
    createCanonicalKey,
    createProviderReferences,
} from "../../src/post-purchase/idempotency/index.mjs";

function line(number = 1, overrides = {}) {
    return {
        providerScope: "GELATO",
        shopifyOrderId: `gid://shopify/Order/${1000 + number}`,
        shopifyLineItemId: `gid://shopify/LineItem/${2000 + number}`,
        shopifyFulfillmentOrderId: `gid://shopify/FulfillmentOrder/${3000 + number}`,
        shopifyFulfillmentOrderLineItemId: `gid://shopify/FulfillmentOrderLineItem/${4000 + number}`,
        shopifyVariantId: `gid://shopify/ProductVariant/${5000 + number}`,
        quantity: 1,
        ...overrides,
    };
}

function setup(providerOptions = {}, repository = new InMemoryIdempotencyRepository()) {
    const provider = new FakeGelatoProvider(providerOptions);
    const service = new ProductionIdempotencyService({ repository, provider });
    return { provider, repository, service };
}

async function expectCode(promise, code) {
    await assert.rejects(promise, error => error.code === code);
}

test("TEST_01 same canonical key creates one record atomically", async () => {
    const { repository, service } = setup();
    const results = await Promise.all(Array.from({ length: 10 }, () => service.registerLine(line())));
    assert.equal(results.filter(result => result.created).length, 1);
    assert.equal(repository.snapshot().records.length, 1);
});

test("TEST_02 deterministic references remain stable across retries and differ by line", () => {
    const first = line(1);
    const same = createProviderReferences(first.shopifyFulfillmentOrderId, first.shopifyFulfillmentOrderLineItemId);
    const retry = createProviderReferences(first.shopifyFulfillmentOrderId, first.shopifyFulfillmentOrderLineItemId);
    const other = createProviderReferences(first.shopifyFulfillmentOrderId, line(2).shopifyFulfillmentOrderLineItemId);
    assert.deepEqual(same, retry);
    assert.notEqual(same.itemReferenceId, other.itemReferenceId);
    assert.equal(same.orderReferenceId, other.orderReferenceId);
});

test("TEST_03 second approval is blocked without a second provider call", async () => {
    const { provider, service } = setup();
    await service.approve(line());
    await expectCode(service.approve(line()), IDEMPOTENCY_ERROR_CODES.ALREADY_SUBMITTED);
    assert.equal(provider.submissions.length, 1);
});

test("TEST_04 submitted line cannot resubmit", async () => {
    const { provider, service } = setup();
    const submitted = await service.approve(line());
    assert.equal(submitted.state, PRODUCTION_STATES.SUBMITTED);
    await expectCode(service.approve(line()), IDEMPOTENCY_ERROR_CODES.ALREADY_SUBMITTED);
    assert.equal(provider.submissions.length, 1);
});

test("TEST_05 in-production line cannot resubmit", async () => {
    const { provider, service } = setup();
    const submitted = await service.approve(line());
    await service.markInProduction(submitted.canonical_key);
    await expectCode(service.approve(line()), IDEMPOTENCY_ERROR_CODES.ALREADY_IN_PRODUCTION);
    assert.equal(provider.submissions.length, 1);
});

test("TEST_06 shipped line cannot resubmit", async () => {
    const { provider, service } = setup();
    const submitted = await service.approve(line());
    await service.markInProduction(submitted.canonical_key);
    await service.markShipped(submitted.canonical_key);
    await expectCode(service.approve(line()), IDEMPOTENCY_ERROR_CODES.ALREADY_SHIPPED);
    assert.equal(provider.submissions.length, 1);
});

test("TEST_07 cancelled pending line cannot submit", async () => {
    const { provider, service } = setup();
    const registered = await service.registerLine(line());
    await service.cancel(registered.record.canonical_key);
    await expectCode(service.approve(line()), IDEMPOTENCY_ERROR_CODES.CANCELLED_NOT_PRODUCIBLE);
    assert.equal(provider.submissions.length, 0);
});

test("TEST_08 unknown response requires reconciliation and forbids blind retry", async () => {
    const { provider, service } = setup({ scenarios: [FAKE_PROVIDER_SCENARIOS.TIMEOUT_AFTER_PROVIDER_ACCEPTANCE] });
    const unknown = await service.approve(line());
    assert.equal(unknown.state, PRODUCTION_STATES.SUBMISSION_UNKNOWN);
    await expectCode(service.approve(line()), IDEMPOTENCY_ERROR_CODES.SUBMISSION_UNKNOWN_REQUIRES_RECONCILIATION);
    assert.equal(provider.submissions.length, 1);
});

test("TEST_09 lookup found persists provider identity and prevents second submission", async () => {
    const { provider, service } = setup({ scenarios: [FAKE_PROVIDER_SCENARIOS.TIMEOUT_AFTER_PROVIDER_ACCEPTANCE] });
    const unknown = await service.approve(line());
    const reconciled = await service.reconcile(unknown.canonical_key);
    assert.equal(reconciled.state, PRODUCTION_STATES.SUBMITTED);
    assert.match(reconciled.gelato_order_id, /^fake-gelato-/);
    await expectCode(service.approve(line()), IDEMPOTENCY_ERROR_CODES.ALREADY_SUBMITTED);
    assert.equal(provider.submissions.length, 1);
});

test("TEST_10 retry is eligible only after lookup confirms absence", async () => {
    const { provider, service } = setup({
        scenarios: [FAKE_PROVIDER_SCENARIOS.TIMEOUT_AFTER_PROVIDER_ACCEPTANCE, FAKE_PROVIDER_SCENARIOS.SUCCESS],
    });
    const unknown = await service.approve(line());
    provider.ordersByReference.clear();
    const failed = await service.reconcile(unknown.canonical_key);
    assert.equal(failed.state, PRODUCTION_STATES.FAILED_BEFORE_ACCEPTANCE);
    const retried = await service.approve(line());
    assert.equal(retried.state, PRODUCTION_STATES.SUBMITTED);
    assert.equal(provider.submissions.length, 2);
});

test("TEST_11 provider receives exact Shopify fulfillment quantity", async () => {
    for (const quantity of [1, 2, 5]) {
        const { provider, service } = setup();
        await service.approve(line(quantity, { quantity }));
        assert.equal(provider.submissions[0].quantity, quantity);
    }
});

test("TEST_12 accepted timeout reconciliation does not multiply quantity", async () => {
    const { provider, service } = setup({ scenarios: [FAKE_PROVIDER_SCENARIOS.TIMEOUT_AFTER_PROVIDER_ACCEPTANCE] });
    const unknown = await service.approve(line(1, { quantity: 2 }));
    const reconciled = await service.reconcile(unknown.canonical_key);
    assert.equal(reconciled.quantity, 2);
    assert.equal(provider.submissions.length, 1);
    assert.equal(provider.submissions.reduce((sum, submission) => sum + submission.quantity, 0), 2);
});

test("TEST_13 failed line retry does not resubmit successful neighboring lines", async () => {
    const { provider, service } = setup({
        scenarios: [
            FAKE_PROVIDER_SCENARIOS.SUCCESS,
            FAKE_PROVIDER_SCENARIOS.FAIL_BEFORE_PROVIDER_ACCEPTANCE,
            FAKE_PROVIDER_SCENARIOS.SUCCESS,
            FAKE_PROVIDER_SCENARIOS.SUCCESS,
        ],
    });
    const a = await service.approve(line(1));
    const b = await service.approve(line(2));
    const c = await service.approve(line(3));
    assert.equal(b.state, PRODUCTION_STATES.FAILED_BEFORE_ACCEPTANCE);
    await service.approve(line(2));
    const counts = provider.submissions.reduce((map, submission) => {
        map.set(submission.canonicalKey, (map.get(submission.canonicalKey) ?? 0) + 1);
        return map;
    }, new Map());
    assert.equal(counts.get(a.canonical_key), 1);
    assert.equal(counts.get(b.canonical_key), 2);
    assert.equal(counts.get(c.canonical_key), 1);
});

test("TEST_14 mixed-provider lines are rejected before record or provider activity", async () => {
    const { provider, repository, service } = setup();
    await expectCode(service.approve(line(1, { providerScope: "DSERS" })), IDEMPOTENCY_ERROR_CODES.PROVIDER_SCOPE_MISMATCH);
    assert.equal(provider.submissions.length, 0);
    assert.equal(repository.snapshot().records.length, 0);
});

test("TEST_15 concurrent approvals have exactly one winner", async () => {
    const repository = new InMemoryIdempotencyRepository();
    const provider = new FakeGelatoProvider({ latency: 10 });
    const services = Array.from({ length: 3 }, () => new ProductionIdempotencyService({ repository, provider }));
    const results = await Promise.allSettled(services.map(service => service.approve(line())));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 2);
    assert.equal(provider.submissions.length, 1);
});

test("TEST_16 repository snapshot restart preserves submitted guard", async () => {
    const first = setup();
    await first.service.approve(line());
    const restartedRepository = new InMemoryIdempotencyRepository(first.repository.snapshot());
    const restartedService = new ProductionIdempotencyService({ repository: restartedRepository, provider: first.provider });
    await expectCode(restartedService.approve(line()), IDEMPOTENCY_ERROR_CODES.ALREADY_SUBMITTED);
    assert.equal(first.provider.submissions.length, 1);
});

test("TEST_17 structured audit events contain identity, transition, actor, attempt and quantity", async () => {
    const { repository, service } = setup();
    const submitted = await service.approve(line(1, { quantity: 2 }));
    const events = await repository.listAuditEvents(submitted.canonical_key);
    assert.deepEqual(events.map(event => event.operation_type), ["REGISTER_LINE", "SUBMIT_PRODUCTION", "SUBMIT_PRODUCTION"]);
    const accepted = events.at(-1);
    assert.equal(accepted.state_before, PRODUCTION_STATES.SUBMITTING);
    assert.equal(accepted.state_after, PRODUCTION_STATES.SUBMITTED);
    assert.equal(accepted.attempt_number, 1);
    assert.equal(accepted.actor, "OPERATOR");
    assert.equal(accepted.quantity, 2);
    assert.ok(accepted.timestamp);
    assert.ok(accepted.provider_reference);
});

test("TEST_18 invalid state transition is rejected", async () => {
    const { repository, service } = setup();
    const submitted = await service.approve(line());
    await assert.rejects(
        repository.compareAndTransitionState(
            submitted.canonical_key,
            [PRODUCTION_STATES.SUBMITTED],
            PRODUCTION_STATES.SHIPPED,
        ),
        error => error.code === IDEMPOTENCY_ERROR_CODES.INVALID_STATE_TRANSITION,
    );
});

test("three simultaneous approvals still produce one submission", async () => {
    const repository = new InMemoryIdempotencyRepository();
    const provider = new FakeGelatoProvider({ latency: 10 });
    const services = Array.from({ length: 3 }, () => new ProductionIdempotencyService({ repository, provider }));
    const results = await Promise.allSettled(services.map(service => service.approve(line())));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(provider.submissions.length, 1);
});

test("approval and cancellation race has one state winner", async () => {
    const { provider, repository, service } = setup({ latency: 10 });
    const registered = await service.registerLine(line());
    const results = await Promise.allSettled([
        service.approve(line()),
        service.cancel(registered.record.canonical_key),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const record = await repository.getByCanonicalKey(registered.record.canonical_key);
    assert.ok([PRODUCTION_STATES.CANCELLED, PRODUCTION_STATES.SUBMITTED].includes(record.state));
    assert.ok(provider.submissions.length <= 1);
});

test("retry and reconciliation race cannot issue a blind submission", async () => {
    const { provider, service } = setup({ scenarios: [FAKE_PROVIDER_SCENARIOS.TIMEOUT_AFTER_PROVIDER_ACCEPTANCE] });
    const unknown = await service.approve(line());
    const results = await Promise.allSettled([
        service.approve(line()),
        service.reconcile(unknown.canonical_key),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(provider.submissions.length, 1);
});

test("duplicate callback-like state invocation cannot resubmit production", async () => {
    const { provider, service } = setup();
    const submitted = await service.approve(line());
    await service.markInProduction(submitted.canonical_key);
    await assert.rejects(service.markInProduction(submitted.canonical_key));
    assert.equal(provider.submissions.length, 1);
});

test("two service instances sharing one repository honor the canonical lock", async () => {
    const repository = new InMemoryIdempotencyRepository();
    const provider = new FakeGelatoProvider({ latency: 10 });
    const first = new ProductionIdempotencyService({ repository, provider });
    const second = new ProductionIdempotencyService({ repository, provider });
    const results = await Promise.allSettled([first.approve(line()), second.approve(line())]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(provider.submissions.length, 1);
});

test("different fulfillment line identities process independently in parallel", async () => {
    const { provider, service } = setup({ latency: 10 });
    const results = await Promise.all([service.approve(line(1)), service.approve(line(2)), service.approve(line(3))]);
    assert.equal(results.filter(record => record.state === PRODUCTION_STATES.SUBMITTED).length, 3);
    assert.equal(provider.submissions.length, 3);
    assert.equal(new Set(provider.submissions.map(submission => submission.canonicalKey)).size, 3);
});

test("lines sharing one fulfillment order reconcile by item reference", async () => {
    const sharedFulfillmentOrderId = "gid://shopify/FulfillmentOrder/777777";
    const { provider, service } = setup({
        scenarios: [
            FAKE_PROVIDER_SCENARIOS.TIMEOUT_AFTER_PROVIDER_ACCEPTANCE,
            FAKE_PROVIDER_SCENARIOS.TIMEOUT_AFTER_PROVIDER_ACCEPTANCE,
        ],
    });
    const firstInput = line(1, { shopifyFulfillmentOrderId: sharedFulfillmentOrderId, quantity: 2 });
    const secondInput = line(2, { shopifyFulfillmentOrderId: sharedFulfillmentOrderId, quantity: 5 });
    const first = await service.approve(firstInput);
    const second = await service.approve(secondInput);
    assert.equal(first.gelato_order_reference_id, second.gelato_order_reference_id);
    assert.notEqual(first.gelato_item_reference_id, second.gelato_item_reference_id);
    const firstReconciled = await service.reconcile(first.canonical_key);
    const secondReconciled = await service.reconcile(second.canonical_key);
    assert.equal(firstReconciled.quantity, 2);
    assert.equal(secondReconciled.quantity, 5);
    assert.notEqual(firstReconciled.gelato_order_id, secondReconciled.gelato_order_id);
    assert.equal(provider.submissions.length, 2);
});

test("pre-acceptance failure can be cancelled and never retried", async () => {
    const { provider, service } = setup({ scenarios: [FAKE_PROVIDER_SCENARIOS.FAIL_BEFORE_PROVIDER_ACCEPTANCE] });
    const failed = await service.approve(line());
    assert.equal(failed.state, PRODUCTION_STATES.FAILED_BEFORE_ACCEPTANCE);
    await service.cancel(failed.canonical_key);
    await expectCode(service.approve(line()), IDEMPOTENCY_ERROR_CODES.CANCELLED_NOT_PRODUCIBLE);
    assert.equal(provider.submissions.length, 1);
});

test("provider lookup failure leaves unknown state and blocks resubmission", async () => {
    const { provider, repository, service } = setup({
        scenarios: [FAKE_PROVIDER_SCENARIOS.TIMEOUT_AFTER_PROVIDER_ACCEPTANCE],
        lookupFailure: true,
    });
    const unknown = await service.approve(line());
    await expectCode(service.reconcile(unknown.canonical_key), IDEMPOTENCY_ERROR_CODES.PROVIDER_RECONCILIATION_FAILED);
    const current = await repository.getByCanonicalKey(unknown.canonical_key);
    assert.equal(current.state, PRODUCTION_STATES.SUBMISSION_UNKNOWN);
    assert.equal(provider.submissions.length, 1);
});

test("provider lookup with wrong order reference cannot become submitted", async () => {
    let capturedPayload;
    const provider = {
        submissions: [],
        async submitProduction(payload) {
            capturedPayload = structuredClone(payload);
            this.submissions.push(capturedPayload);
            throw new ProviderSubmissionError("Unknown acceptance outcome.", {
                code: "TIMEOUT_AFTER_ACCEPTANCE",
                acceptanceUnknown: true,
            });
        },
        async findOrderByReference() {
            return {
                providerOrderId: "fake-wrong-order-reference",
                orderReferenceId: "wrong-order-reference",
                itemReferenceId: capturedPayload.itemReferenceId,
                quantity: capturedPayload.quantity,
            };
        },
    };
    const repository = new InMemoryIdempotencyRepository();
    const service = new ProductionIdempotencyService({ repository, provider });
    const unknown = await service.approve(line());
    await expectCode(service.reconcile(unknown.canonical_key), IDEMPOTENCY_ERROR_CODES.PROVIDER_RECONCILIATION_FAILED);
    const current = await repository.getByCanonicalKey(unknown.canonical_key);
    assert.equal(current.state, PRODUCTION_STATES.SUBMISSION_UNKNOWN);
    assert.equal(current.gelato_order_id, null);
    assert.equal(provider.submissions.length, 1);
    const auditEvents = await repository.listAuditEvents(unknown.canonical_key);
    const rejection = auditEvents.at(-1);
    assert.equal(rejection.operation_type, "RECONCILE_PROVIDER");
    assert.equal(rejection.result, "RECONCILIATION_REJECTED");
    assert.equal(rejection.error_code, IDEMPOTENCY_ERROR_CODES.PROVIDER_RECONCILIATION_FAILED);
    assert.equal(rejection.state_before, PRODUCTION_STATES.SUBMISSION_UNKNOWN);
    assert.equal(rejection.state_after, PRODUCTION_STATES.SUBMISSION_UNKNOWN);
});

test("timeout before acceptance is safely retryable without changing provider references", async () => {
    const { provider, service } = setup({
        scenarios: [FAKE_PROVIDER_SCENARIOS.TIMEOUT_BEFORE_PROVIDER_ACCEPTANCE, FAKE_PROVIDER_SCENARIOS.SUCCESS],
    });
    const failed = await service.approve(line(1, { quantity: 5 }));
    assert.equal(failed.state, PRODUCTION_STATES.FAILED_BEFORE_ACCEPTANCE);
    const submitted = await service.approve(line(1, { quantity: 5 }));
    assert.equal(submitted.state, PRODUCTION_STATES.SUBMITTED);
    assert.equal(provider.submissions.length, 2);
    assert.equal(provider.submissions[0].orderReferenceId, provider.submissions[1].orderReferenceId);
    assert.equal(provider.submissions[0].itemReferenceId, provider.submissions[1].itemReferenceId);
    assert.equal(provider.submissions[0].quantity, 5);
    assert.equal(provider.submissions[1].quantity, 5);
});

test("restart during unknown state reconciles before any new submission", async () => {
    const first = setup({ scenarios: [FAKE_PROVIDER_SCENARIOS.TIMEOUT_AFTER_PROVIDER_ACCEPTANCE] });
    const unknown = await first.service.approve(line());
    const restartedRepository = new InMemoryIdempotencyRepository(first.repository.snapshot());
    const restartedService = new ProductionIdempotencyService({ repository: restartedRepository, provider: first.provider });
    await expectCode(restartedService.approve(line()), IDEMPOTENCY_ERROR_CODES.SUBMISSION_UNKNOWN_REQUIRES_RECONCILIATION);
    const reconciled = await restartedService.reconcile(unknown.canonical_key);
    assert.equal(reconciled.state, PRODUCTION_STATES.SUBMITTED);
    assert.equal(first.provider.submissions.length, 1);
});

test("invalid quantities are rejected before persistence or provider activity", async () => {
    for (const quantity of [0, -1, 1.5, Number.NaN]) {
        const { provider, repository, service } = setup();
        await expectCode(service.approve(line(1, { quantity })), IDEMPOTENCY_ERROR_CODES.INVALID_QUANTITY);
        assert.equal(provider.submissions.length, 0);
        assert.equal(repository.snapshot().records.length, 0);
    }
});

test("financial refund status is recorded but does not mutate production state", async () => {
    const { provider, service } = setup();
    const registered = await service.registerLine(line(1, { financialStatus: "REFUNDED" }));
    assert.equal(registered.record.financial_status, "REFUNDED");
    assert.equal(registered.record.state, PRODUCTION_STATES.PENDING_APPROVAL);
    assert.equal(provider.submissions.length, 0);
});

test("canonical key is exactly fulfillment order plus fulfillment line identity", () => {
    const input = line();
    assert.equal(
        createCanonicalKey(input.shopifyFulfillmentOrderId, input.shopifyFulfillmentOrderLineItemId),
        `${input.shopifyFulfillmentOrderId}::${input.shopifyFulfillmentOrderLineItemId}`,
    );
});

test("reference repository never presents itself as a production persistence backend", () => {
    assert.equal(PRODUCTION_PERSISTENCE_BACKEND, "NOT_YET_SELECTED");
});

test("an existing canonical key rejects immutable Shopify identity drift", async () => {
    const { provider, service } = setup();
    await service.registerLine(line());
    await expectCode(
        service.approve(line(1, { shopifyVariantId: "gid://shopify/ProductVariant/999999" })),
        IDEMPOTENCY_ERROR_CODES.INVALID_STATE_TRANSITION,
    );
    assert.equal(provider.submissions.length, 0);
});

test("atomic transitions cannot patch immutable fulfillment identity", async () => {
    const immutableFields = {
        canonical_key: "wrong-key",
        provider_scope: "OTHER",
        shopify_order_id: "gid://shopify/Order/999991",
        shopify_line_item_id: "gid://shopify/LineItem/999992",
        shopify_fulfillment_order_id: "gid://shopify/FulfillmentOrder/999993",
        shopify_fulfillment_order_line_item_id: "gid://shopify/FulfillmentOrderLineItem/999994",
        shopify_variant_id: "gid://shopify/ProductVariant/999995",
        quantity: 99,
        gelato_order_reference_id: "wrong-order-reference",
        gelato_item_reference_id: "wrong-item-reference",
        created_at: "1999-01-01T00:00:00.000Z",
    };

    for (const [field, value] of Object.entries(immutableFields)) {
        const repository = new InMemoryIdempotencyRepository();
        const service = new ProductionIdempotencyService({ repository, provider: new FakeGelatoProvider() });
        const registered = await service.registerLine(line());
        await expectCode(
            repository.compareAndTransitionState(
                registered.record.canonical_key,
                [PRODUCTION_STATES.PENDING_APPROVAL],
                PRODUCTION_STATES.SUBMITTING,
                { [field]: value },
            ),
            IDEMPOTENCY_ERROR_CODES.INVALID_STATE_TRANSITION,
        );
        const current = await repository.getByCanonicalKey(registered.record.canonical_key);
        assert.equal(current.state, PRODUCTION_STATES.PENDING_APPROVAL);
    }
});

test("corrupt persisted records fail closed before repository use", async () => {
    const { repository, service } = setup();
    await service.approve(line());
    const baseline = repository.snapshot();
    const mutations = [
        record => { delete record.canonical_key; },
        record => { record.canonical_key = "wrong"; },
        record => { delete record.shopify_fulfillment_order_id; },
        record => { delete record.shopify_fulfillment_order_line_item_id; },
        record => { record.gelato_order_reference_id = "wrong"; },
        record => { record.gelato_item_reference_id = "wrong"; },
        record => { record.quantity = 0; },
        record => { record.state = "UNKNOWN_STATE"; },
        record => { delete record.provider_scope; },
        record => { record.shopify_variant_id = "gid://shopify/ProductVariant/different"; delete record.shopify_line_item_id; },
    ];

    for (const mutate of mutations) {
        const snapshot = structuredClone(baseline);
        mutate(snapshot.records[0]);
        assert.throws(
            () => new InMemoryIdempotencyRepository(snapshot),
            error => error.code === IDEMPOTENCY_ERROR_CODES.CORRUPT_PERSISTED_RECORD,
        );
    }
});

test("corrupt submitted restart cannot create a second provider submission", async () => {
    const first = setup();
    await first.service.approve(line());
    const snapshot = first.repository.snapshot();
    delete snapshot.records[0].canonical_key;
    const restartedProvider = new FakeGelatoProvider();
    assert.throws(
        () => new InMemoryIdempotencyRepository(snapshot),
        error => error.code === IDEMPOTENCY_ERROR_CODES.CORRUPT_PERSISTED_RECORD,
    );
    assert.equal(restartedProvider.submissions.length, 0);
});

test("snapshot records schema distinguishes fresh repositories from corrupt persistence", () => {
    assert.doesNotThrow(() => new InMemoryIdempotencyRepository());
    assert.doesNotThrow(() => new InMemoryIdempotencyRepository(null));
    assert.doesNotThrow(() => new InMemoryIdempotencyRepository({ records: [], auditEvents: [] }));

    for (const snapshot of [
        {},
        { auditEvents: [] },
        { records: null },
        { records: {} },
        { records: "" },
        { records: 1 },
    ]) {
        assert.throws(
            () => new InMemoryIdempotencyRepository(snapshot),
            error => error.code === IDEMPOTENCY_ERROR_CODES.CORRUPT_PERSISTED_RECORD,
        );
    }
});

test("submitted snapshot missing records fails closed before restart submission", async () => {
    const first = setup();
    await first.service.approve(line());
    const snapshot = first.repository.snapshot();
    delete snapshot.records;
    const restartedProvider = new FakeGelatoProvider();
    assert.throws(
        () => new InMemoryIdempotencyRepository(snapshot),
        error => error.code === IDEMPOTENCY_ERROR_CODES.CORRUPT_PERSISTED_RECORD,
    );
    assert.equal(restartedProvider.submissions.length, 0);
});

test("duplicate approval rejection is audited without changing state", async () => {
    const { repository, service } = setup();
    const submitted = await service.approve(line());
    const before = (await repository.listAuditEvents(submitted.canonical_key)).length;
    await expectCode(service.approve(line()), IDEMPOTENCY_ERROR_CODES.ALREADY_SUBMITTED);
    const events = await repository.listAuditEvents(submitted.canonical_key);
    assert.equal(events.length, before + 1);
    assert.deepEqual(events.at(-1), {
        audit_id: events.at(-1).audit_id,
        canonical_key: submitted.canonical_key,
        state_before: PRODUCTION_STATES.SUBMITTED,
        state_after: PRODUCTION_STATES.SUBMITTED,
        attempt_number: 1,
        actor: "OPERATOR",
        timestamp: events.at(-1).timestamp,
        operation_type: "APPROVE_PRODUCTION",
        result: "SECOND_APPROVAL_REJECTED",
        error_code: IDEMPOTENCY_ERROR_CODES.ALREADY_SUBMITTED,
        error_message: events.at(-1).error_message,
        provider_reference: submitted.gelato_order_reference_id,
        provider_item_reference: submitted.gelato_item_reference_id,
        provider_order_id: submitted.gelato_order_id,
        quantity: submitted.quantity,
    });
});

test("submission-in-progress and unknown-state approval rejections are audited", async () => {
    const repository = new InMemoryIdempotencyRepository();
    const provider = new FakeGelatoProvider({ scenarios: [FAKE_PROVIDER_SCENARIOS.TIMEOUT_AFTER_PROVIDER_ACCEPTANCE] });
    const service = new ProductionIdempotencyService({ repository, provider });
    const pending = await service.registerLine(line(1));
    await repository.compareAndTransitionState(
        pending.record.canonical_key,
        [PRODUCTION_STATES.PENDING_APPROVAL],
        PRODUCTION_STATES.SUBMITTING,
    );
    await expectCode(service.approve(line(1)), IDEMPOTENCY_ERROR_CODES.SUBMISSION_IN_PROGRESS);
    assert.equal((await repository.listAuditEvents(pending.record.canonical_key)).at(-1).result, "SUBMISSION_IN_PROGRESS_REJECTED");

    const unknown = await service.approve(line(2));
    await expectCode(service.approve(line(2)), IDEMPOTENCY_ERROR_CODES.SUBMISSION_UNKNOWN_REQUIRES_RECONCILIATION);
    assert.equal((await repository.listAuditEvents(unknown.canonical_key)).at(-1).result, "SUBMISSION_UNKNOWN_REJECTED");
});

test("post-submission cancellation conflicts are audited", async () => {
    const { repository, service } = setup();
    const submitted = await service.approve(line());
    await expectCode(service.cancel(submitted.canonical_key, "QA_OPERATOR"), IDEMPOTENCY_ERROR_CODES.INVALID_STATE_TRANSITION);
    let event = (await repository.listAuditEvents(submitted.canonical_key)).at(-1);
    assert.equal(event.operation_type, "CANCEL_PRODUCTION");
    assert.equal(event.result, "CANCEL_AFTER_SUBMITTED_REJECTED");
    assert.equal(event.state_before, event.state_after);
    assert.equal(event.actor, "QA_OPERATOR");

    await service.markInProduction(submitted.canonical_key);
    await expectCode(service.cancel(submitted.canonical_key, "QA_OPERATOR"), IDEMPOTENCY_ERROR_CODES.INVALID_STATE_TRANSITION);
    event = (await repository.listAuditEvents(submitted.canonical_key)).at(-1);
    assert.equal(event.result, "CANCEL_AFTER_IN_PRODUCTION_REJECTED");
    assert.equal(event.state_before, event.state_after);
});

test("invalid service transition rejection is audited", async () => {
    const { repository, service } = setup();
    const submitted = await service.approve(line());
    await expectCode(service.markShipped(submitted.canonical_key, "QA_STATUS"), IDEMPOTENCY_ERROR_CODES.INVALID_STATE_TRANSITION);
    const event = (await repository.listAuditEvents(submitted.canonical_key)).at(-1);
    assert.equal(event.operation_type, "MARK_SHIPPED");
    assert.equal(event.result, "INVALID_STATE_TRANSITION");
    assert.equal(event.error_code, IDEMPOTENCY_ERROR_CODES.INVALID_STATE_TRANSITION);
    assert.equal(event.state_before, event.state_after);
    assert.equal(event.actor, "QA_STATUS");
});
