import assert from "node:assert/strict";
import {
    createProductOptionsService,
    normalizeProductOptions,
    PRODUCT_PURCHASE_MODES,
} from "../docs/assets/js/commerce/product-options.js";

const registryProduct = Object.freeze({ key: "TEST", productId: "123", title: "Registry title" });

function variant(id, options, {
    availableForSale = true,
    requiresComponents = false,
    minimum = 1,
    maximum = null,
    increment = 1,
    amount = "10.00",
} = {}) {
    return {
        id: `gid://shopify/ProductVariant/${id}`,
        availableForSale,
        requiresComponents,
        selectedOptions: Object.entries(options).map(([name, value]) => ({ name, value })),
        quantityRule: { minimum, maximum, increment },
        price: { amount, currencyCode: "USD" },
    };
}

function normalize(variants) {
    return normalizeProductOptions({
        registryProduct,
        storefrontProduct: { title: "Live title", availableForSale: variants.some(item => item.availableForSale) },
        variants,
    });
}

const simple = normalize([variant("1", { "Default Title": "Default Title" })]);
assert.equal(simple.purchaseMode, PRODUCT_PURCHASE_MODES.SIMPLE);
assert.deepEqual(simple.optionNames, []);
assert.equal(simple.purchasableVariants.length, 1);

const singleDimension = normalize([
    variant("1", { Color: "Black" }),
    variant("2", { Color: "Gold" }),
]);
assert.equal(singleDimension.purchaseMode, PRODUCT_PURCHASE_MODES.MULTI_VARIANT_SINGLE_DIMENSION);
assert.deepEqual(singleDimension.optionNames, ["Color"]);

const multipleDimensions = normalize([
    variant("1", { Color: "Black", Size: "M" }),
    variant("2", { Color: "White", Size: "L" }),
]);
assert.equal(multipleDimensions.purchaseMode, PRODUCT_PURCHASE_MODES.MULTI_VARIANT_MULTI_DIMENSION);
assert.equal(multipleDimensions.variants[0].optionLabel, "Black / M");
assert.equal(multipleDimensions.variants[0].accessibleLabel, "Color: Black, Size: M");

const unavailable = normalize([variant("1", { Color: "Black" }, { availableForSale: false })]);
assert.equal(unavailable.purchaseMode, PRODUCT_PURCHASE_MODES.UNAVAILABLE);
assert.equal(unavailable.purchasableVariants.length, 0);

const components = normalize([variant("1", { Color: "Black" }, { requiresComponents: true })]);
assert.equal(components.purchaseMode, PRODUCT_PURCHASE_MODES.UNSUPPORTED_REQUIRES_COMPONENTS);

const pagedCalls = [];
const pagedService = createProductOptionsService({
    pageSize: 1,
    client: {
        async getProductVariants(id, variables) {
            pagedCalls.push({ id, variables });
            const secondPage = variables.after === "cursor-1";
            return {
                title: "Paged product",
                availableForSale: true,
                variants: {
                    nodes: [variant(secondPage ? "2" : "1", { Color: secondPage ? "White" : "Black" })],
                    pageInfo: secondPage
                        ? { hasNextPage: false, endCursor: null }
                        : { hasNextPage: true, endCursor: "cursor-1" },
                },
            };
        },
    },
});
const paged = await pagedService.load(registryProduct);
assert.equal(paged.variants.length, 2);
assert.equal(pagedCalls.length, 2);
assert.equal(pagedCalls[1].variables.after, "cursor-1");

console.log(JSON.stringify({
    simpleMode: true,
    singleDimensionMode: true,
    multipleDimensionMode: true,
    unavailableMode: true,
    componentMode: true,
    pagination: true,
    safeLabels: true,
}, null, 2));
