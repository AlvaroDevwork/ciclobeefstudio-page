import assert from "node:assert/strict";
import { createCartUiController, initializeQaCart, isCbsCartQaEnabled } from "../docs/assets/js/commerce/cart-ui.js";
import { createCartManager } from "../docs/assets/js/commerce/cart.js";
import { CommerceError, COMMERCE_ERROR_CODES } from "../docs/assets/js/commerce/storefront-client.js";

class ClassList {
    constructor(node) {
        this.node = node;
    }

    add(...tokens) {
        const values = new Set(this.node.className.split(/\s+/).filter(Boolean));
        tokens.forEach(token => values.add(token));
        this.node.className = [...values].join(" ");
    }

    remove(...tokens) {
        const removed = new Set(tokens);
        this.node.className = this.node.className
            .split(/\s+/)
            .filter(token => token && !removed.has(token))
            .join(" ");
    }
}

class TestNode {
    constructor(documentRef, tagName) {
        this.documentRef = documentRef;
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.attributes = new Map();
        this.listeners = new Map();
        this.className = "";
        this.classList = new ClassList(this);
        this.textContent = "";
        this.hidden = false;
        this.disabled = false;
    }

    append(...nodes) {
        this.children.push(...nodes);
    }

    replaceChildren(...nodes) {
        this.children = [...nodes];
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    async trigger(type, properties = {}) {
        const event = {
            currentTarget: this,
            target: this,
            preventDefault() {},
            ...properties,
        };
        for (const listener of this.listeners.get(type) ?? []) {
            await listener(event);
        }
    }

    focus() {
        this.documentRef.activeElement = this;
    }

    querySelectorAll() {
        return descendants(this).filter(node => {
            if (node.hidden || node.disabled) return false;
            return node.tagName === "BUTTON"
                || (node.tagName === "A" && node.getAttribute("href"))
                || node.getAttribute("tabindex") === "0";
        });
    }
}

class TestDocument {
    constructor() {
        this.body = new TestNode(this, "body");
        this.activeElement = this.body;
    }

    createElement(tagName) {
        return new TestNode(this, tagName);
    }

    createElementNS(_namespace, tagName) {
        return this.createElement(tagName);
    }
}

function descendants(node) {
    return node.children.flatMap(child => [child, ...descendants(child)]);
}

function find(root, predicate) {
    return descendants(root).find(predicate);
}

function byClass(root, className) {
    return find(root, node => node.className.split(/\s+/).includes(className));
}

function byText(root, text) {
    return find(root, node => node.textContent === text);
}

function money(amount) {
    return { amount: String(amount), currencyCode: "USD" };
}

function line({ id, title, quantity, color, size, maximum = 10, canRemove = true, canUpdateQuantity = true }) {
    return {
        id,
        quantity,
        instructions: { canRemove, canUpdateQuantity },
        cost: { totalAmount: money(quantity * 25) },
        merchandise: {
            id: `gid://shopify/ProductVariant/${id}`,
            title: [color, size].filter(Boolean).join(" / ") || "Default Title",
            availableForSale: true,
            quantityRule: { minimum: 1, maximum, increment: 1 },
            selectedOptions: [
                color && { name: "Color", value: color },
                size && { name: "Size", value: size },
            ].filter(Boolean),
            product: { title },
            image: {
                url: `https://cdn.shopify.com/${id}.jpg`,
                altText: `${title} ${color ?? ""}`.trim(),
                width: 300,
                height: 300,
            },
        },
    };
}

function cart(lines) {
    return {
        totalQuantity: lines.reduce((total, item) => total + item.quantity, 0),
        lines: { nodes: lines },
        cost: { subtotalAmount: money(lines.reduce((total, item) => total + Number(item.cost.totalAmount.amount), 0)) },
    };
}

function managerHarness(initialCart) {
    let value = initialCart;
    const calls = { getCart: 0, updates: [], removals: [], checkout: 0 };
    return {
        calls,
        setCart(nextCart) { value = nextCart; },
        manager: {
            async getCart() {
                calls.getCart += 1;
                return value;
            },
            async updateLines(updates) {
                calls.updates.push(updates);
                const update = updates[0];
                value = cart(value.lines.nodes.map(item => item.id === update.id
                    ? { ...item, quantity: update.quantity, cost: { totalAmount: money(update.quantity * 25) } }
                    : item));
                return { cart: value, warnings: [] };
            },
            async removeLines(ids) {
                calls.removals.push(ids);
                value = cart(value.lines.nodes.filter(item => !ids.includes(item.id)));
                return { cart: value, warnings: [] };
            },
            async getCheckoutUrl() {
                calls.checkout += 1;
                return "https://shop.ciclobeefstudio.com/checkouts/test";
            },
        },
    };
}

assert.equal(isCbsCartQaEnabled({ hostname: "127.0.0.1", search: "?cbs-cart-qa=1" }), true);
assert.equal(isCbsCartQaEnabled({ hostname: "ciclobeefstudio.com", search: "?cbs-cart-qa=1" }), false);
assert.equal(isCbsCartQaEnabled({ hostname: "127.0.0.1", search: "" }), false);

const emptyDocument = new TestDocument();
const emptyHarness = managerHarness(null);
const emptyController = createCartUiController({ manager: emptyHarness.manager, documentRef: emptyDocument });
const emptyLauncher = byClass(emptyDocument.body, "cbs-cart-qa__launcher");
await emptyLauncher.trigger("click");
assert.deepEqual(emptyController.getSnapshot(), { isOpen: true, isBusy: false, totalQuantity: 0, lineCount: 0 });
assert.ok(byText(emptyDocument.body, "Your cart is empty."));
assert.equal(emptyHarness.calls.getCart, 1, "Opening an empty cart must read without creating a cart.");
emptyController.close();
assert.equal(emptyDocument.activeElement, emptyLauncher, "Closing returns focus to the launcher.");

let releaseLoading;
const loadingDocument = new TestDocument();
const loadingManager = {
    getCart: () => new Promise(resolve => { releaseLoading = resolve; }),
};
createCartUiController({ manager: loadingManager, documentRef: loadingDocument });
const loadingOpen = byClass(loadingDocument.body, "cbs-cart-qa__launcher").trigger("click");
await Promise.resolve();
assert.ok(byText(loadingDocument.body, "Loading your cart…"));
assert.equal(byClass(loadingDocument.body, "cbs-cart").hidden, true, "A restored cart must remain hidden until rehydration finishes.");
releaseLoading(null);
await loadingOpen;
assert.equal(byClass(loadingDocument.body, "cbs-cart").hidden, false, "The cart may open after its canonical renderer finishes rehydration.");

const mixedLines = [
    line({ id: "black", title: "Victory Horse", quantity: 2, color: "Black" }),
    line({ id: "gold", title: "Victory Horse", quantity: 1, color: "Gold" }),
    line({ id: "hoodie", title: "Studio Hoodie", quantity: 2, color: "White", size: "Medium", maximum: 2, canRemove: false }),
];
const populatedDocument = new TestDocument();
const populatedHarness = managerHarness(cart(mixedLines));
let checkoutDestination = null;
const populatedController = createCartUiController({
    manager: populatedHarness.manager,
    documentRef: populatedDocument,
    navigate: url => { checkoutDestination = url; },
});
await byClass(populatedDocument.body, "cbs-cart-qa__launcher").trigger("click");
assert.deepEqual(populatedController.getSnapshot(), { isOpen: true, isBusy: false, totalQuantity: 5, lineCount: 3 });
assert.equal(byClass(populatedDocument.body, "cbs-cart-qa__badge").textContent, "5");
assert.ok(byText(populatedDocument.body, "Color"));
assert.ok(byText(populatedDocument.body, "Medium"));

const quantityGroups = descendants(populatedDocument.body)
    .filter(node => node.className === "cbs-cart-line__quantity");
assert.equal(quantityGroups[1].children[0].disabled, true, "Minimum quantity must disable decrement.");
assert.equal(quantityGroups[2].children[2].disabled, true, "Maximum quantity must disable increment.");
const initialRemoveButtons = descendants(populatedDocument.body)
    .filter(node => node.className === "cbs-cart-line__remove");
assert.equal(initialRemoveButtons[2].disabled, true, "Line instructions must disable removal.");
await quantityGroups[1].children[2].trigger("click");
assert.deepEqual(populatedHarness.calls.updates.at(-1), [{ id: "gold", quantity: 2 }]);
assert.equal(populatedController.getSnapshot().totalQuantity, 6);

const removeButtons = descendants(populatedDocument.body)
    .filter(node => node.className === "cbs-cart-line__remove");
await removeButtons[0].trigger("click");
assert.deepEqual(populatedHarness.calls.removals.at(-1), ["black"]);
assert.equal(populatedController.getSnapshot().lineCount, 2);

await byClass(populatedDocument.body, "cbs-cart__checkout").trigger("click");
assert.equal(populatedHarness.calls.checkout, 1);
assert.equal(checkoutDestination, "https://shop.ciclobeefstudio.com/checkouts/test");

const errorDocument = new TestDocument();
const errorManager = {
    async getCart() {
        throw new CommerceError(COMMERCE_ERROR_CODES.NETWORK_ERROR, "Internal transport detail");
    },
};
createCartUiController({ manager: errorManager, documentRef: errorDocument });
await byClass(errorDocument.body, "cbs-cart-qa__launcher").trigger("click");
assert.ok(byText(errorDocument.body, "We couldn’t reach the cart. Check your connection and try again."));
assert.equal(descendants(errorDocument.body).some(node => node.textContent.includes("Internal transport detail")), false);

// Persisted-cart reload regression: use a real cart manager, retain only its
// versioned cart reference, and rebuild the entire document/controller on each
// reload. Every mount must recreate the same shell and line controls.
const persistedValues = new Map();
const persistedStorage = {
    getItem: key => persistedValues.get(key) ?? null,
    setItem: (key, value) => persistedValues.set(key, value),
    removeItem: key => persistedValues.delete(key),
};
const persistedLines = [
    line({ id: "gid://shopify/CartLine/persisted-black", title: "Aereocrya Dreams", quantity: 2, color: "Black", size: "50 × 70 cm" }),
    line({ id: "gid://shopify/CartLine/persisted-gold", title: "Aereocrya Dreams", quantity: 1, color: "Gold", size: "60 × 90 cm" }),
    line({ id: "gid://shopify/CartLine/persisted-white", title: "Studio Edition", quantity: 3, color: "White", size: "Large" }),
];
let persistedCart = null;
const persistenceCalls = { creates: 0, reads: 0, additions: 0, removals: [] };
const persistenceClient = {
    async createCart() {
        persistenceCalls.creates += 1;
        persistedCart = { id: "gid://shopify/Cart/rehydration", checkoutUrl: "https://shop.ciclobeefstudio.com/checkouts/rehydration", ...cart([]) };
        return { cart: persistedCart, warnings: [] };
    },
    async getCart(id) {
        persistenceCalls.reads += 1;
        assert.equal(id, "gid://shopify/Cart/rehydration");
        return persistedCart;
    },
    async addCartLines(id, additions) {
        persistenceCalls.additions += 1;
        assert.equal(id, persistedCart.id);
        assert.deepEqual(additions.map(item => item.quantity), [2, 1, 3]);
        persistedCart = { ...persistedCart, ...cart(persistedLines) };
        return { cart: persistedCart, warnings: [] };
    },
    async updateCartLines() {
        throw new Error("Quantity updates are not part of this reload scenario.");
    },
    async removeCartLines(id, ids) {
        assert.equal(id, persistedCart.id);
        persistenceCalls.removals.push(ids);
        persistedCart = { ...persistedCart, ...cart(persistedCart.lines.nodes.filter(item => !ids.includes(item.id))) };
        return { cart: persistedCart, warnings: [] };
    },
};
const persistenceConfig = {
    cartStorageKey: "cbs.commerce.cart.v1",
    cartStorageVersion: 1,
};
const initialManager = createCartManager({ client: persistenceClient, storage: persistedStorage, config: persistenceConfig });
await initialManager.addLines(persistedLines.map(item => ({ merchandiseId: item.merchandise.id, quantity: item.quantity })));
assert.deepEqual(JSON.parse(persistedValues.get(persistenceConfig.cartStorageKey)), {
    version: 1,
    id: "gid://shopify/Cart/rehydration",
}, "Persistence must contain only the version and cart ID.");

const reloadResults = [];
for (let reload = 1; reload <= 3; reload += 1) {
    const reloadDocument = new TestDocument();
    const reloadWindow = {};
    const reloadManager = createCartManager({ client: persistenceClient, storage: persistedStorage, config: persistenceConfig });
    const cartApi = initializeQaCart({
        locationRef: { hostname: "127.0.0.1", search: "?cbs-cart-qa=1" },
        windowRef: reloadWindow,
        documentRef: reloadDocument,
        manager: reloadManager,
    });
    assert.equal(initializeQaCart({
        locationRef: { hostname: "127.0.0.1", search: "?cbs-cart-qa=1" },
        windowRef: reloadWindow,
        documentRef: reloadDocument,
        manager: reloadManager,
    }), cartApi, `Reload ${reload} initialization must reuse its mounted controller.`);
    await cartApi.ready;
    await cartApi.open({ currentTarget: reloadDocument.body });

    const roots = descendants(reloadDocument.body).filter(node => node.className === "cbs-cart-qa");
    const panels = descendants(reloadDocument.body).filter(node => node.className === "cbs-cart");
    const closeButtons = descendants(reloadDocument.body).filter(node => node.className === "cbs-cart__icon-button");
    const visibleLines = persistedCart.lines.nodes.length;
    const trashButtons = descendants(reloadDocument.body).filter(node => node.className === "cbs-cart-line__remove");
    const trashIcons = descendants(reloadDocument.body).filter(node => node.getAttribute("class") === "cbs-cart-line__remove-icon");
    const restoredQuantities = descendants(reloadDocument.body).filter(node => node.className === "cbs-cart-line__quantity");
    const restoredSubtotal = byClass(reloadDocument.body, "cbs-cart__subtotal");
    const restoredCheckout = byClass(reloadDocument.body, "cbs-cart__checkout");
    assert.equal(roots.length, 1, `Reload ${reload} must have one CBS Cart root.`);
    assert.equal(panels.length, 1, `Reload ${reload} must have one CBS Cart panel.`);
    assert.equal(closeButtons.length, 1, `Reload ${reload} must recreate exactly one close X.`);
    assert.equal(trashButtons.length, visibleLines, `Reload ${reload} must recreate one trash control per removable line.`);
    assert.equal(trashIcons.length, visibleLines, `Reload ${reload} must recreate every trash SVG.`);
    assert.equal(restoredQuantities.length, visibleLines, `Reload ${reload} must recreate quantity controls for every line.`);
    assert.notEqual(restoredSubtotal.children[1].textContent, "—", `Reload ${reload} must restore the subtotal.`);
    assert.equal(restoredCheckout.disabled, false, `Reload ${reload} must restore checkout availability.`);
    assert.equal(cartApi.getSnapshot().totalQuantity, persistedCart.totalQuantity, `Reload ${reload} must restore the quantity badge source.`);
    reloadResults.push({ reload, lineCount: visibleLines, closeCount: closeButtons.length, trashCount: trashButtons.length });

    if (reload === 1) {
        await trashButtons[1].trigger("click");
        assert.deepEqual(persistenceCalls.removals.at(-1), ["gid://shopify/CartLine/persisted-gold"], "Restored removal must remain line-specific.");
        assert.deepEqual(persistedCart.lines.nodes.map(item => item.id), [
            "gid://shopify/CartLine/persisted-black",
            "gid://shopify/CartLine/persisted-white",
        ]);
    }
}

console.log(JSON.stringify({
    emptyState: true,
    loadingState: true,
    persistedCartRead: populatedHarness.calls.getCart === 1,
    distinctLinesRendered: mixedLines.length,
    totalQuantityBadge: 5,
    selectedOptionsRendered: true,
    quantityRulesEnforced: true,
    quantityUpdate: true,
    lineRemove: true,
    checkoutExplicitAction: true,
    safeErrorState: true,
    persistedReloads: reloadResults,
    persistedDataOnly: true,
    duplicateCartRoots: false,
    restoredLineSpecificRemoval: true,
    publicCutover: false,
}, null, 2));
