import { createHash } from "node:crypto";

function requireShopifyGid(value, resource) {
    const prefix = `gid://shopify/${resource}/`;
    if (typeof value !== "string" || !value.startsWith(prefix) || value.length === prefix.length) {
        throw new TypeError(`Expected a Shopify ${resource} GID.`);
    }
    return value;
}

function stableDigest(value) {
    return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

export function createCanonicalKey(shopifyFulfillmentOrderId, shopifyFulfillmentOrderLineItemId) {
    const orderId = requireShopifyGid(shopifyFulfillmentOrderId, "FulfillmentOrder");
    const lineId = requireShopifyGid(shopifyFulfillmentOrderLineItemId, "FulfillmentOrderLineItem");
    return `${orderId}::${lineId}`;
}

export function createProviderReferences(shopifyFulfillmentOrderId, shopifyFulfillmentOrderLineItemId) {
    const canonicalKey = createCanonicalKey(shopifyFulfillmentOrderId, shopifyFulfillmentOrderLineItemId);
    return Object.freeze({
        canonicalKey,
        orderReferenceId: `cbs-fo-${stableDigest(shopifyFulfillmentOrderId)}`,
        itemReferenceId: `cbs-foli-${stableDigest(shopifyFulfillmentOrderLineItemId)}`,
    });
}
