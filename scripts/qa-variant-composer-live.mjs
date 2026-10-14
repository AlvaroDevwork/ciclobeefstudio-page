import assert from "node:assert/strict";
import { createCartManager } from "../docs/assets/js/commerce/cart.js";
import { createProductOptionsService, PRODUCT_PURCHASE_MODES } from "../docs/assets/js/commerce/product-options.js";
import { PRODUCT_REGISTRY } from "../docs/assets/js/commerce/products.js";
import { createStorefrontClient } from "../docs/assets/js/commerce/storefront-client.js";
import { createComposerSubmission } from "../docs/assets/js/commerce/variant-composer.js";

function createMemoryStorage() {
    const values = new Map();
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    };
}

async function clearCart(manager, cart) {
    const lineIds = cart.lines.nodes.map(line => line.id);
    if (lineIds.length) await manager.removeLines(lineIds);
    manager.clearCartReference();
}

function optionValue(variant, name) {
    const option = variant.selectedOptions.find(selected => selected.name === name);
    return option?.value ?? null;
}

const client = createStorefrontClient();
const service = createProductOptionsService({ client, pageSize: 250 });
const configurations = [];

for (const product of PRODUCT_REGISTRY) {
    configurations.push(await service.load(product));
}

const simpleConfiguration = configurations.find(product => product.purchaseMode === PRODUCT_PURCHASE_MODES.SIMPLE);
const multiConfiguration = configurations.find(product => (
    product.purchaseMode === PRODUCT_PURCHASE_MODES.MULTI_VARIANT_SINGLE_DIMENSION
    && product.optionNames.includes("Color")
    && product.purchasableVariants.length >= 3
)) ?? configurations.find(product => product.optionNames.includes("Color") && product.purchasableVariants.length >= 3);
const multidimensionalConfiguration = configurations.find(product => product.purchaseMode === PRODUCT_PURCHASE_MODES.MULTI_VARIANT_MULTI_DIMENSION);

assert.ok(simpleConfiguration, "The live catalog must include a simple product.");
assert.ok(multiConfiguration, "The live catalog must include a product with at least three purchasable variants.");
assert.ok(multidimensionalConfiguration, "The live catalog must include a multi-dimensional product.");

async function runIsolatedCase({ configuration, configure, expectedTotal, expectedLines }) {
    const manager = createCartManager({ client, storage: createMemoryStorage() });
    const created = await manager.ensureCart();
    let cartToClear = created.cart;
    let addCalls = 0;
    const submission = createComposerSubmission({
        configuration,
        manager: {
            addLines(lines) {
                addCalls += 1;
                return manager.addLines(lines);
            },
        },
    });
    configure(submission.selection);
    assert.equal(submission.selection.isComplete(), true, "The configured set must be complete before submit.");
    try {
        const result = await submission.submit();
        cartToClear = result.cart;
        assert.equal(result.cart.id, created.cart.id, "The composer must preserve one cart.");
        assert.equal(result.cart.totalQuantity, expectedTotal);
        assert.equal(result.cart.lines.nodes.length, expectedLines);
        assert.equal(addCalls, 1, "One customer action must execute one addLines intent.");
        return result;
    } finally {
        await clearCart(manager, cartToClear);
    }
}

await runIsolatedCase({
    configuration: simpleConfiguration,
    configure: selection => selection.setQuantity(1),
    expectedTotal: 1,
    expectedLines: 1,
});

await runIsolatedCase({
    configuration: simpleConfiguration,
    configure: selection => selection.setQuantity(5),
    expectedTotal: 5,
    expectedLines: 1,
});

await runIsolatedCase({
    configuration: multiConfiguration,
    configure: selection => {
        selection.setQuantity(3);
        const optionName = multiConfiguration.optionNames[0];
        selection.setOption(0, optionName, optionValue(multiConfiguration.purchasableVariants[0], optionName));
        selection.setOption(1, optionName, optionValue(multiConfiguration.purchasableVariants[1], optionName));
        selection.setOption(2, optionName, optionValue(multiConfiguration.purchasableVariants[2], optionName));
    },
    expectedTotal: 3,
    expectedLines: 3,
});

const multiLineProof = await runIsolatedCase({
    configuration: multiConfiguration,
    configure: selection => {
        selection.setQuantity(3);
        const optionName = multiConfiguration.optionNames[0];
        selection.setOption(0, optionName, optionValue(multiConfiguration.purchasableVariants[0], optionName));
        selection.setOption(1, optionName, optionValue(multiConfiguration.purchasableVariants[1], optionName));
        selection.setOption(2, optionName, optionValue(multiConfiguration.purchasableVariants[0], optionName));
    },
    expectedTotal: 3,
    expectedLines: 2,
});

await runIsolatedCase({
    configuration: multidimensionalConfiguration,
    configure: selection => {
        selection.setQuantity(2);
        const names = multidimensionalConfiguration.optionNames;
        const first = multidimensionalConfiguration.purchasableVariants[0];
        const second = multidimensionalConfiguration.purchasableVariants[1];
        names.forEach(name => selection.setOption(0, name, optionValue(first, name)));
        names.forEach(name => selection.setOption(1, name, optionValue(second, name)));
    },
    expectedTotal: 2,
    expectedLines: 2,
});

const existingManager = createCartManager({ client, storage: createMemoryStorage() });
const existingCreated = await existingManager.ensureCart();
let existingCartToClear = existingCreated.cart;
try {
    const simpleSubmission = createComposerSubmission({ configuration: simpleConfiguration, manager: existingManager });
    const firstAdd = await simpleSubmission.submit();
    existingCartToClear = firstAdd.cart;
    const multiSubmission = createComposerSubmission({ configuration: multiConfiguration, manager: existingManager });
    multiSubmission.selection.setQuantity(1);
    const optionName = multiConfiguration.optionNames[0];
    multiSubmission.selection.setOption(0, optionName, optionValue(multiConfiguration.purchasableVariants[0], optionName));
    const secondAdd = await multiSubmission.submit();
    existingCartToClear = secondAdd.cart;
    assert.equal(firstAdd.cart.id, existingCreated.cart.id);
    assert.equal(secondAdd.cart.id, existingCreated.cart.id);
    assert.equal(secondAdd.cart.totalQuantity, 2);
} finally {
    await clearCart(existingManager, existingCartToClear);
}

console.log(JSON.stringify({
    productsLoaded: configurations.length,
    simpleProductOne: true,
    simpleProductFive: true,
    threeDistinctUnits: true,
    duplicateAggregation: true,
    multiLineProof: {
        oneCart: true,
        distinctLines: multiLineProof.cart.lines.nodes.length,
        totalQuantity: multiLineProof.cart.totalQuantity,
        product: {
            registryKey: multiConfiguration.registryKey,
            productId: multiConfiguration.productId,
            title: multiConfiguration.title,
            optionNames: multiConfiguration.optionNames,
            variantCount: multiConfiguration.variants.length,
            purchasableVariantCount: multiConfiguration.purchasableVariants.length,
        },
    },
    multiDimensionProof: true,
    addToExistingCart: true,
    checkoutOpened: false,
    cartsCleaned: true,
}, null, 2));
