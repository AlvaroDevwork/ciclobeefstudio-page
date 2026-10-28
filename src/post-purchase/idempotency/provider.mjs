export const REAL_GELATO_SUBMISSION_ENABLED = false;

export const FAKE_PROVIDER_SCENARIOS = Object.freeze({
    SUCCESS: "SUCCESS",
    FAIL_BEFORE_PROVIDER_ACCEPTANCE: "FAIL_BEFORE_PROVIDER_ACCEPTANCE",
    TIMEOUT_AFTER_PROVIDER_ACCEPTANCE: "TIMEOUT_AFTER_PROVIDER_ACCEPTANCE",
    TIMEOUT_BEFORE_PROVIDER_ACCEPTANCE: "TIMEOUT_BEFORE_PROVIDER_ACCEPTANCE",
});

export class ProviderSubmissionError extends Error {
    constructor(message, { code, acceptanceUnknown }) {
        super(message);
        this.name = "ProviderSubmissionError";
        this.code = code;
        this.acceptanceUnknown = acceptanceUnknown;
    }
}

export class ProviderReconciliationGateway {
    async submitProduction() { throw new Error("No real Gelato submission adapter is enabled."); }
    async findOrderByReference() { throw new Error("Provider lookup adapter must be implemented."); }
    async getOrderStatus() { throw new Error("Provider status adapter must be implemented."); }
}

export class FakeGelatoProvider extends ProviderReconciliationGateway {
    constructor({ scenarios = [], lookupFailure = false, latency = 0 } = {}) {
        super();
        this.scenarios = [...scenarios];
        this.lookupFailure = lookupFailure;
        this.latency = latency;
        this.submissions = [];
        this.ordersByReference = new Map();
        this.nextOrderNumber = 1;
    }

    async submitProduction(payload) {
        if (this.latency) await new Promise(resolve => setTimeout(resolve, this.latency));
        const scenario = this.scenarios.shift() ?? FAKE_PROVIDER_SCENARIOS.SUCCESS;
        const submission = structuredClone(payload);
        this.submissions.push(submission);

        if (scenario === FAKE_PROVIDER_SCENARIOS.FAIL_BEFORE_PROVIDER_ACCEPTANCE) {
            throw new ProviderSubmissionError("Provider rejected before acceptance.", {
                code: "PROVIDER_REJECTED",
                acceptanceUnknown: false,
            });
        }
        if (scenario === FAKE_PROVIDER_SCENARIOS.TIMEOUT_BEFORE_PROVIDER_ACCEPTANCE) {
            throw new ProviderSubmissionError("Network timeout before provider acceptance.", {
                code: "TIMEOUT_BEFORE_ACCEPTANCE",
                acceptanceUnknown: false,
            });
        }

        const order = {
            providerOrderId: `fake-gelato-${this.nextOrderNumber++}`,
            orderReferenceId: payload.orderReferenceId,
            itemReferenceId: payload.itemReferenceId,
            quantity: payload.quantity,
            status: "SUBMITTED",
        };
        const items = this.ordersByReference.get(payload.orderReferenceId) ?? new Map();
        items.set(payload.itemReferenceId, structuredClone(order));
        this.ordersByReference.set(payload.orderReferenceId, items);

        if (scenario === FAKE_PROVIDER_SCENARIOS.TIMEOUT_AFTER_PROVIDER_ACCEPTANCE) {
            throw new ProviderSubmissionError("Network timeout after provider acceptance.", {
                code: "TIMEOUT_AFTER_ACCEPTANCE",
                acceptanceUnknown: true,
            });
        }
        return structuredClone(order);
    }

    async findOrderByReference(orderReferenceId, itemReferenceId) {
        if (this.lookupFailure) throw new Error("Simulated provider lookup failure.");
        return structuredClone(this.ordersByReference.get(orderReferenceId)?.get(itemReferenceId) ?? null);
    }

    async getOrderStatus(providerOrderId) {
        const orders = [...this.ordersByReference.values()].flatMap(items => [...items.values()]);
        return structuredClone(orders.find(order => order.providerOrderId === providerOrderId) ?? null);
    }
}
