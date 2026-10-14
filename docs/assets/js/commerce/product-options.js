import { createStorefrontClient } from "./storefront-client.js";

export const PRODUCT_PURCHASE_MODES = Object.freeze({
    SIMPLE: "SIMPLE",
    MULTI_VARIANT_SINGLE_DIMENSION: "MULTI_VARIANT_SINGLE_DIMENSION",
    MULTI_VARIANT_MULTI_DIMENSION: "MULTI_VARIANT_MULTI_DIMENSION",
    UNAVAILABLE: "UNAVAILABLE",
    UNSUPPORTED_REQUIRES_COMPONENTS: "UNSUPPORTED_REQUIRES_COMPONENTS",
});

function positiveInteger(value, fallback = null) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeQuantityRule(rule = {}) {
    const minimum = positiveInteger(rule.minimum, 1);
    const increment = positiveInteger(rule.increment, 1);
    const maximum = positiveInteger(rule.maximum);

    return Object.freeze({
        minimum,
        maximum: maximum !== null && maximum >= minimum ? maximum : null,
        increment,
    });
}

function normalizeMoney(money = {}) {
    const amount = Number(money.amount);
    return Object.freeze({
        amount: Number.isFinite(amount) ? String(money.amount) : null,
        currencyCode: typeof money.currencyCode === "string" ? money.currencyCode : null,
    });
}

function normalizeOption(option) {
    return Object.freeze({
        name: String(option?.name ?? "Option").trim(),
        value: String(option?.value ?? "").trim(),
    });
}

function isDefaultOption(option) {
    return option.name === "Default Title" || option.value === "Default Title";
}

function normalizeVariant(variant) {
    const selectedOptions = Object.freeze((variant?.selectedOptions ?? []).map(normalizeOption));
    const displayOptions = selectedOptions.filter(option => !isDefaultOption(option) && option.value);
    const optionLabel = displayOptions.map(option => option.value).join(" / ") || "Standard option";
    const accessibleLabel = displayOptions.map(option => `${option.name}: ${option.value}`).join(", ") || "Standard option";
    const requiresComponents = variant?.requiresComponents === true;
    const availableForSale = variant?.availableForSale === true;
    const id = String(variant?.id ?? "");

    return Object.freeze({
        id,
        availableForSale,
        requiresComponents,
        purchasable: id.startsWith("gid://shopify/ProductVariant/") && availableForSale && !requiresComponents,
        selectedOptions,
        optionLabel,
        accessibleLabel,
        quantityRule: normalizeQuantityRule(variant?.quantityRule),
        price: normalizeMoney(variant?.price),
    });
}

function classifyProduct(variants, optionNames) {
    const purchasable = variants.filter(variant => variant.purchasable);

    if (variants.length && variants.every(variant => variant.requiresComponents)) {
        return PRODUCT_PURCHASE_MODES.UNSUPPORTED_REQUIRES_COMPONENTS;
    }
    if (!purchasable.length) {
        return PRODUCT_PURCHASE_MODES.UNAVAILABLE;
    }
    if (purchasable.length === 1) {
        return PRODUCT_PURCHASE_MODES.SIMPLE;
    }
    return optionNames.length <= 1
        ? PRODUCT_PURCHASE_MODES.MULTI_VARIANT_SINGLE_DIMENSION
        : PRODUCT_PURCHASE_MODES.MULTI_VARIANT_MULTI_DIMENSION;
}

export function normalizeProductOptions({ registryProduct, storefrontProduct, variants }) {
    const normalizedVariants = Object.freeze(variants.map(normalizeVariant));
    const optionNames = Object.freeze([...new Set(
        normalizedVariants.flatMap(variant => variant.selectedOptions)
            .filter(option => !isDefaultOption(option) && option.value)
            .map(option => option.name),
    )]);
    const purchaseMode = classifyProduct(normalizedVariants, optionNames);

    return Object.freeze({
        registryKey: registryProduct.key,
        productId: registryProduct.productId,
        title: String(storefrontProduct.title ?? registryProduct.title),
        availableForSale: storefrontProduct.availableForSale === true,
        optionNames,
        purchaseMode,
        variants: normalizedVariants,
        purchasableVariants: Object.freeze(normalizedVariants.filter(variant => variant.purchasable)),
    });
}

export function createProductOptionsService({ client = createStorefrontClient(), pageSize = 100 } = {}) {
    const safePageSize = Math.min(250, Math.max(1, Number(pageSize) || 100));

    return Object.freeze({
        async load(registryProduct) {
            if (!registryProduct?.key || !/^\d+$/.test(registryProduct.productId ?? "")) {
                throw new TypeError("A registered Shopify product is required.");
            }

            const productGid = `gid://shopify/Product/${registryProduct.productId}`;
            const variants = [];
            let after = null;
            let storefrontProduct = null;

            do {
                storefrontProduct = await client.getProductVariants(productGid, { first: safePageSize, after });
                variants.push(...(storefrontProduct.variants?.nodes ?? []));
                after = storefrontProduct.variants?.pageInfo?.hasNextPage
                    ? storefrontProduct.variants.pageInfo.endCursor
                    : null;
            } while (after);

            return normalizeProductOptions({ registryProduct, storefrontProduct, variants });
        },
    });
}
