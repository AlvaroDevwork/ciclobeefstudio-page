const SHOPIFY_DOMAIN = "8vatph-xn.myshopify.com";
const PUBLIC_STOREFRONT_ACCESS_TOKEN = "32ab61c4c7e464fb88df4d131fe15b3c";
const COMMERCE_QA_HOSTS = new Set(["127.0.0.1", "localhost"]);
const COMMERCE_QA_QUERY_PARAMETER = "cbs-cart-qa";

export function isLocalCommerceQaEnabled(locationRef = globalThis.location) {
    return Boolean(locationRef)
        && COMMERCE_QA_HOSTS.has(locationRef.hostname)
        && new URLSearchParams(locationRef.search).get(COMMERCE_QA_QUERY_PARAMETER) === "1";
}

export const SHOPIFY_CONFIG = Object.freeze({
    domain: SHOPIFY_DOMAIN,
    storefrontAccessToken: PUBLIC_STOREFRONT_ACCESS_TOKEN,
    sdkUrl: "https://sdks.shopifycdn.com/buy-button/latest/buy-button-storefront.min.js",
    sdkScriptId: "cbs-shopify-buy-sdk",
    mountSelector: "[data-shopify-product-key]",
    observer: Object.freeze({
        rootMargin: "240px 0px",
        threshold: 0.01,
    }),
});

export const STOREFRONT_CONFIG = Object.freeze({
    domain: SHOPIFY_DOMAIN,
    apiVersion: "2026-10",
    endpoint: `https://${SHOPIFY_DOMAIN}/api/2026-10/graphql.json`,
    publicAccessToken: PUBLIC_STOREFRONT_ACCESS_TOKEN,
    cartStorageKey: "cbs.commerce.cart.v1",
    cartStorageVersion: 1,
});
