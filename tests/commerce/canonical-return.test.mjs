import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { openExistingShopifyCart } from "../../docs/assets/js/commerce/shopify-buy.js";
import { SHOPIFY_CONFIG } from "../../docs/assets/js/commerce/config.js";

const contract = JSON.parse(fs.readFileSync("config/shopify-redirect-contract.json", "utf8"));
const routeHtml = fs.readFileSync("docs/cart/index.html", "utf8");
const routeSource = fs.readFileSync("docs/assets/js/commerce/cart-return.js", "utf8");
const rootHtml = fs.readFileSync("docs/index.html", "utf8");
const storageKey = `${SHOPIFY_CONFIG.storefrontAccessToken}.${SHOPIFY_CONFIG.domain}.checkoutId`;

function storage(value, { throws = false } = {}) {
    return {
        getItem(key) {
            assert.equal(key, storageKey);
            if (throws) throw new Error("blocked storage");
            return value;
        },
    };
}

function uiWithCart(lineItems = [{ id: "line-1" }]) {
    let createCount = 0;
    let openCount = 0;
    const ui = {
        components: { cart: [{ model: { lineItems } }] },
        createComponent() {
            createCount += 1;
        },
        openCart() {
            openCount += 1;
        },
    };
    return { ui, counts: () => ({ createCount, openCount }) };
}

test("canonical route opens the existing Buy Button singleton without creating another cart", async () => {
    const { ui, counts } = uiWithCart();
    const result = await openExistingShopifyCart({
        storage: storage("gid://shopify/Checkout/existing"),
        loadUi: async () => ui,
    });

    assert.deepEqual(result, { status: "opened", lineItemCount: 1 });
    assert.deepEqual(counts(), { createCount: 0, openCount: 1 });
});

test("a persisted checkout may initialize exactly one SDK cart component", async () => {
    globalThis.window = { matchMedia: () => ({ matches: false }), setTimeout };
    let createCount = 0;
    let openCount = 0;
    const ui = {
        components: { cart: [] },
        createComponent(type) {
            assert.equal(type, "cart");
            createCount += 1;
            this.components.cart.push({ model: { lineItems: [{ id: "line-1" }] } });
        },
        openCart() {
            openCount += 1;
        },
    };

    const result = await openExistingShopifyCart({
        storage: storage("gid://shopify/Checkout/existing"),
        documentRef: { body: {} },
        loadUi: async () => ui,
        timeoutMs: 0,
    });

    assert.equal(result.status, "opened");
    assert.equal(createCount, 1);
    assert.equal(ui.components.cart.length, 1);
    assert.equal(openCount, 1);
    delete globalThis.window;
});

test("missing, blocked, empty and unavailable cart states fail back without cart recreation", async () => {
    let uiLoads = 0;
    const loadUi = async () => {
        uiLoads += 1;
        throw new Error("SDK unavailable");
    };

    assert.equal((await openExistingShopifyCart({ storage: storage(null), loadUi })).status, "missing");
    assert.equal((await openExistingShopifyCart({ storage: storage(null, { throws: true }), loadUi })).status, "missing");
    assert.equal(uiLoads, 0);

    const empty = uiWithCart([]);
    assert.equal((await openExistingShopifyCart({
        storage: storage("gid://shopify/Checkout/empty"),
        loadUi: async () => empty.ui,
    })).status, "empty");
    assert.deepEqual(empty.counts(), { createCount: 0, openCount: 0 });

    assert.equal((await openExistingShopifyCart({
        storage: storage("corrupt-reference"),
        loadUi,
    })).status, "unavailable");
});

test("redirect contract is fixed to the canonical HTTPS origin with no open redirect input", () => {
    assert.equal(contract.canonicalOrigin, "https://ciclobeefstudio.com");
    assert.equal(contract.storefrontHostname, "ciclobeefstudio.com");
    assert.equal(contract.cartReturnPath, "/cart/");
    assert.equal(contract.defaultPathBehavior, "preserve");
    assert.deepEqual(contract.preservedPaths, ["/"]);
    assert.equal(contract.unlistedCommercePathsRequireReview, true);
    assert.equal(contract.customRedirects.find(rule => rule.source === "/cart")?.target, "/cart/");
    assert.equal(contract.customRedirects.filter(rule => rule.kind === "product").length, 16);
    assert.equal(new Set(contract.customRedirects.map(rule => rule.source)).size, contract.customRedirects.length);

    contract.customRedirects.forEach(rule => {
        assert.match(rule.source, /^\/[a-z0-9/_-]+$/);
        assert.ok(rule.target === "/" || rule.target === "/cart/");
        const target = new URL(rule.target, contract.canonicalOrigin);
        assert.equal(target.origin, contract.canonicalOrigin);
        assert.equal(target.protocol, "https:");
        assert.equal(target.username, "");
        assert.equal(target.password, "");
    });

    assert.doesNotMatch(routeSource, /URLSearchParams|location\.search|location\.assign|location\.replace|innerHTML/);
});

test("canonical cart route preserves customer-safe navigation, policies and responsive hooks", () => {
    assert.match(routeHtml, /<link rel="canonical" href="https:\/\/ciclobeefstudio\.com\/cart\/">/);
    assert.match(routeHtml, /href="\/#products"/);
    assert.match(routeHtml, /href="\/privacy\/"/);
    assert.match(routeHtml, /href="\/terms\/"/);
    assert.match(routeHtml, /role="status"/);
    assert.match(routeHtml, /aria-live="polite"/);
    assert.doesNotMatch(routeHtml, /shop\.ciclobeefstudio\.com|javascript:|provider|fulfillment|Stage|GitHub/i);
    assert.match(rootHtml, /href="\/privacy\/"/);
    assert.match(rootHtml, /href="\/terms\/"/);
});
