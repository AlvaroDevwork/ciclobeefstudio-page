import assert from "node:assert/strict";
import { normalizeProductOptions, PRODUCT_PURCHASE_MODES } from "../docs/assets/js/commerce/product-options.js";
import {
    createComposerSelection,
    createComposerSubmission,
    initializeVariantComposerQa,
} from "../docs/assets/js/commerce/variant-composer.js";

const registryProduct = Object.freeze({ key: "TEST", productId: "123", title: "Composer test" });

function variant(id, options, { minimum = 1, maximum = null, increment = 1, availableForSale = true } = {}) {
    return {
        id: `gid://shopify/ProductVariant/${id}`,
        availableForSale,
        requiresComponents: false,
        selectedOptions: Object.entries(options).map(([name, value]) => ({ name, value })),
        quantityRule: { minimum, maximum, increment },
        price: { amount: "10.00", currencyCode: "USD" },
    };
}

function configuration(variants) {
    return normalizeProductOptions({
        registryProduct,
        storefrontProduct: { title: "Composer test", availableForSale: true },
        variants,
    });
}

function resolvedIds(lines) {
    return lines.map(line => `${line.merchandiseId.split("/").pop()}:${line.quantity}`);
}

const simpleConfig = configuration([variant("simple", { "Default Title": "Default Title" })]);
assert.equal(simpleConfig.purchaseMode, PRODUCT_PURCHASE_MODES.SIMPLE);
const simple = createComposerSelection(simpleConfig);
assert.equal(simple.getQuantity(), 1, "A simple product starts at its real minimum.");
for (let index = 1; index < 5; index += 1) simple.increase();
assert.equal(simple.getQuantity(), 5, "A simple product supports quantity five when allowed.");
assert.deepEqual(simple.getLines().map(line => line.quantity), [5]);
assert.equal(simple.getTotal(), 5);

const multiConfig = configuration([
    variant("black", { Color: "Black" }),
    variant("gold", { Color: "Gold" }),
    variant("white", { Color: "White" }),
]);
assert.equal(multiConfig.purchaseMode, PRODUCT_PURCHASE_MODES.MULTI_VARIANT_SINGLE_DIMENSION);

const multi = createComposerSelection(multiConfig);
assert.equal(multi.getQuantity(), 1, "A multi-variant set starts with one configurable unit.");
assert.equal(multi.isComplete(), false, "An unconfigured unit is not complete.");
multi.setQuantity(3);
assert.equal(multi.getQuantity(), 3);
multi.setOption(0, "Color", "Black");
multi.setOption(1, "Color", "Gold");
multi.setOption(2, "Color", "White");
assert.equal(multi.isComplete(), true);
assert.deepEqual(resolvedIds(multi.getLines()), ["black:1", "gold:1", "white:1"], "Three distinct variants become three lines.");
assert.equal(multi.getTotal(), 3);

const duplicate = createComposerSelection(multiConfig);
duplicate.setQuantity(3);
duplicate.setOption(0, "Color", "Black");
duplicate.setOption(1, "Color", "Gold");
duplicate.setOption(2, "Color", "Black");
assert.deepEqual(resolvedIds(duplicate.getLines()), ["black:2", "gold:1"], "Identical variants aggregate into one line.");
assert.equal(duplicate.getTotal(), 3);
assert.equal(duplicate.getLines().length, 2);

const unresolved = createComposerSelection(multiConfig);
unresolved.setQuantity(2);
unresolved.setOption(0, "Color", "Black");
assert.equal(unresolved.isComplete(), false, "A missing unit option blocks completion.");
assert.deepEqual(unresolved.getUnresolvedUnitIndexes(), [1]);

const multidimensional = configuration([
    variant("black-m", { Color: "Black", Size: "M" }),
    variant("black-l", { Color: "Black", Size: "L" }),
    variant("white-l", { Color: "White", Size: "L" }),
]);
assert.equal(multidimensional.purchaseMode, PRODUCT_PURCHASE_MODES.MULTI_VARIANT_MULTI_DIMENSION);
const multiDim = createComposerSelection(multidimensional);
multiDim.setQuantity(2);
multiDim.setOption(0, "Color", "Black");
multiDim.setOption(0, "Size", "M");
multiDim.setOption(1, "Color", "White");
multiDim.setOption(1, "Size", "L");
assert.equal(multiDim.isComplete(), true, "Real Size + Color combinations resolve.");
assert.deepEqual(resolvedIds(multiDim.getLines()), ["black-m:1", "white-l:1"]);

multiDim.setOption(1, "Size", "M");
assert.equal(multiDim.isComplete(), false, "A synthetic White / M combination must not resolve.");
assert.equal(multiDim.getUnresolvedUnitIndexes().length, 1);

const rulesConfig = configuration([
    variant("rule-a", { Color: "Black" }, { minimum: 2, maximum: 6, increment: 2 }),
]);
const rules = createComposerSelection(rulesConfig);
assert.equal(rules.getQuantity(), 2, "A simple product honours a non-unit minimum.");
rules.increase();
rules.increase();
assert.equal(rules.getQuantity(), 6);
rules.increase();
assert.equal(rules.getQuantity(), 6, "A simple product honours its maximum.");
rules.decrease();
assert.equal(rules.getQuantity(), 4);

let addCalls = 0;
let lastLines = null;
const submission = createComposerSubmission({
    configuration: multiConfig,
    manager: {
        async addLines(lines) {
            addCalls += 1;
            lastLines = lines;
            return { cart: { totalQuantity: 8 }, warnings: [] };
        },
    },
});
await assert.rejects(submission.submit(), /configured/i, "An unconfigured unit set is rejected.");
submission.selection.setQuantity(2);
submission.selection.setOption(0, "Color", "Black");
submission.selection.setOption(1, "Color", "White");
const firstSubmit = submission.submit();
const duplicateSubmit = submission.submit();
const [firstResult, duplicateResult] = await Promise.all([firstSubmit, duplicateSubmit]);
assert.equal(addCalls, 1, "Concurrent submit attempts share one mutation.");
assert.deepEqual(resolvedIds(lastLines), ["black:1", "white:1"]);
assert.equal(firstResult.cart.totalQuantity, 8);
assert.equal(duplicateResult, firstResult);
assert.equal(submission.selection.getQuantity(), 1, "A successful multi-variant add resets to one empty unit.");

assert.equal(initializeVariantComposerQa({
    mounts: [],
    getProduct: () => null,
    locationRef: { hostname: "ciclobeefstudio.com", search: "?cbs-cart-qa=1" },
}), false, "The composer must not initialize publicly.");

const qaMount = { dataset: { shopifyProductKey: "TEST" } };
const qaWindow = {};
let qaMountedProduct = null;
const qaController = {
    mount(node, product) {
        assert.equal(node, qaMount);
        qaMountedProduct = product;
    },
};
assert.equal(initializeVariantComposerQa({
    mounts: [qaMount],
    getProduct: key => key === "TEST" ? registryProduct : null,
    locationRef: { hostname: "127.0.0.1", search: "?cbs-cart-qa=1" },
    controller: qaController,
    windowRef: qaWindow,
}), true, "The composer must own Buy now routing in local QA mode.");
assert.equal(qaMountedProduct, registryProduct);
assert.equal(qaWindow.CBSVariantComposerQA, qaController);

console.log(JSON.stringify({
    simpleMinimum: true,
    simpleFive: true,
    singleUnitDefault: true,
    unitCompletionGuard: true,
    threeDistinctLines: true,
    duplicateAggregation: true,
    unresolvedUnitDetection: true,
    multiDimensionResolution: true,
    syntheticCombinationGuard: true,
    quantityRules: true,
    zeroSelectionGuard: true,
    doubleAddProtection: true,
    postAddReset: true,
    publicGate: true,
    qaGateActive: true,
}, null, 2));
