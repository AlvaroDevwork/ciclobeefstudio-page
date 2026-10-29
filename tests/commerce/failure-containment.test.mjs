import assert from "node:assert/strict";
import test from "node:test";

import { createCartManager } from "../../docs/assets/js/commerce/cart.js";
import {
    COMMERCE_ERROR_CODES,
    createStorefrontClient,
} from "../../docs/assets/js/commerce/storefront-client.js";

const config = Object.freeze({
    endpoint: "https://storefront.invalid/api",
    publicAccessToken: "public-test-token",
    requestTimeoutMs: 25,
    cartStorageKey: "cbs.test.cart",
    cartStorageVersion: 1,
    checkoutHosts: Object.freeze(["shop.ciclobeefstudio.com"]),
});

function response(payload) {
    return { ok: true, status: 200, json: async () => payload };
}

function cart(id, checkoutUrl, { lines = [cartLine()], totalQuantity = 1 } = {}) {
    return {
        id,
        checkoutUrl,
        totalQuantity,
        lines: { nodes: lines },
        cost: {},
    };
}

function cartLine() {
    return {
        id: "gid://shopify/CartLine/test-line",
        quantity: 1,
        merchandise: { id: "gid://shopify/ProductVariant/test-variant" },
    };
}

function storageFor(id) {
    const values = new Map([[config.cartStorageKey, JSON.stringify({
        version: config.cartStorageVersion,
        id,
    })]]);
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    };
}

async function expectCommerceCode(promise, code) {
    await assert.rejects(promise, error => error.code === code);
}

test("Storefront request succeeds before its deadline", async () => {
    const client = createStorefrontClient({
        config,
        fetchImpl: async () => response({
            data: {
                cartCreate: {
                    cart: cart("gid://shopify/Cart/success", "https://shop.ciclobeefstudio.com/checkouts/success"),
                    userErrors: [],
                    warnings: [],
                },
            },
        }),
    });
    assert.equal((await client.createCart()).cart.id, "gid://shopify/Cart/success");
});

test("network rejection and AbortError become deterministic network errors", async () => {
    for (const error of [new Error("offline"), Object.assign(new Error("aborted"), { name: "AbortError" })]) {
        const client = createStorefrontClient({ config, fetchImpl: async () => { throw error; } });
        await expectCommerceCode(client.createCart(), COMMERCE_ERROR_CODES.NETWORK_ERROR);
    }
});

test("never-settling request is aborted at the configured deadline", async () => {
    let capturedSignal;
    const client = createStorefrontClient({
        config,
        requestTimeoutMs: 10,
        fetchImpl: async (url, options) => {
            capturedSignal = options.signal;
            return new Promise(() => {});
        },
    });
    await expectCommerceCode(client.createCart(), COMMERCE_ERROR_CODES.NETWORK_ERROR);
    assert.equal(capturedSignal.aborted, true);
});

test("approved non-empty checkout is accepted", async () => {
    const id = "gid://shopify/Cart/approved";
    const manager = createCartManager({
        config,
        storage: storageFor(id),
        client: { getCart: async () => cart(id, "https://shop.ciclobeefstudio.com/checkouts/approved") },
    });
    assert.equal(await manager.getCheckoutUrl(), "https://shop.ciclobeefstudio.com/checkouts/approved");
});

test("empty or structurally invalid cart cannot prepare checkout", async () => {
    const cases = [
        { lines: [], totalQuantity: 0 },
        { lines: [cartLine()], totalQuantity: 0 },
        { lines: [{ ...cartLine(), quantity: 0 }], totalQuantity: 1 },
        { lines: [{ ...cartLine(), merchandise: { id: "invalid" } }], totalQuantity: 1 },
        { lines: [{ ...cartLine(), id: "gid://shopify/CartLine/" }], totalQuantity: 1 },
        { lines: [{ ...cartLine(), id: "gid://shopify/CartLine/   " }], totalQuantity: 1 },
        { lines: [{ ...cartLine(), merchandise: { id: "gid://shopify/ProductVariant/" } }], totalQuantity: 1 },
        { lines: [{ ...cartLine(), merchandise: { id: "gid://shopify/ProductVariant/   " } }], totalQuantity: 1 },
        { lines: [cartLine()], totalQuantity: 2 },
        { lines: [{ ...cartLine(), quantity: 2 }, { ...cartLine(), id: "gid://shopify/CartLine/second", quantity: 3 }], totalQuantity: 1 },
        { lines: [cartLine(), { ...cartLine(), id: "gid://shopify/CartLine/second" }], totalQuantity: 1 },
        { lines: [cartLine()], totalQuantity: 1.5 },
        { lines: [cartLine()], totalQuantity: "1" },
        { lines: [cartLine()], totalQuantity: -1 },
    ];
    for (const [index, state] of cases.entries()) {
        const id = `gid://shopify/Cart/empty-${index}`;
        const manager = createCartManager({
            config,
            storage: storageFor(id),
            client: { getCart: async () => cart(id, "https://shop.ciclobeefstudio.com/checkouts/empty", state) },
        });
        await expectCommerceCode(manager.getCheckoutUrl(), COMMERCE_ERROR_CODES.INVALID_CART);
    }
});

test("checkout accepts structurally valid GIDs and exact aggregate quantity", async () => {
    const cases = [
        { lines: [cartLine()], totalQuantity: 1 },
        {
            lines: [
                { ...cartLine(), id: "gid://shopify/CartLine/abc", quantity: 2 },
                {
                    ...cartLine(),
                    id: "gid://shopify/CartLine/123",
                    quantity: 3,
                    merchandise: { id: "gid://shopify/ProductVariant/123" },
                },
            ],
            totalQuantity: 5,
        },
    ];
    for (const [index, state] of cases.entries()) {
        const id = `gid://shopify/Cart/valid-${index}`;
        const checkoutUrl = `https://shop.ciclobeefstudio.com/checkouts/valid-${index}`;
        const manager = createCartManager({
            config,
            storage: storageFor(id),
            client: { getCart: async () => cart(id, checkoutUrl, state) },
        });
        assert.equal(await manager.getCheckoutUrl(), checkoutUrl);
    }
});

test("missing, malformed, insecure, unexpected and spoofed checkout URLs are rejected", async () => {
    const rejected = [
        null,
        "not-a-url",
        "/checkouts/relative",
        "javascript:alert(1)",
        "http://shop.ciclobeefstudio.com/checkouts/x",
        "https://evil.example/checkouts/x",
        "https://shop.ciclobeefstudio.com.evil.example/checkouts/x",
        "https://shop.ciclobeefstudio.com@evil.example/checkouts/x",
        "https://shop.ciclobeefstudio.com:444/checkouts/x",
    ];
    for (const [index, checkoutUrl] of rejected.entries()) {
        const id = `gid://shopify/Cart/rejected-${index}`;
        const manager = createCartManager({
            config,
            storage: storageFor(id),
            client: { getCart: async () => cart(id, checkoutUrl) },
        });
        await expectCommerceCode(manager.getCheckoutUrl(), COMMERCE_ERROR_CODES.INVALID_CART);
    }
});
