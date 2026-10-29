import { createCartManager } from "../docs/assets/js/commerce/cart.js";
import { createStorefrontClient } from "../docs/assets/js/commerce/storefront-client.js";
import { PRODUCT_REGISTRY } from "../docs/assets/js/commerce/products.js";

function createMemoryStorage() {
    const values = new Map();
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    };
}

function productGid(productId) {
    return `gid://shopify/Product/${productId}`;
}

async function findVariantProofSet(client) {
    const fallback = [];

    for (const registryProduct of PRODUCT_REGISTRY) {
        const product = await client.getProductVariants(productGid(registryProduct.productId), { first: 100 });
        const variants = product.variants.nodes.filter(variant => variant.availableForSale && !variant.requiresComponents);
        fallback.push(...variants);

        if (variants.length >= 3) {
            return { productTitle: product.title, variants: variants.slice(0, 3), sameProduct: true };
        }
    }

    if (fallback.length >= 3) {
        return { productTitle: "Multiple products", variants: fallback.slice(0, 3), sameProduct: false };
    }

    throw new Error("The active catalog does not expose three purchasable variants for the capability proof.");
}

const client = createStorefrontClient();
const manager = createCartManager({ client, storage: createMemoryStorage() });
const proof = await findVariantProofSet(client);
const created = await manager.ensureCart();
const createdCartId = created.cart.id;
const read = await manager.getCart();
const added = await manager.addLines([
    { merchandiseId: proof.variants[0].id, quantity: 2 },
    { merchandiseId: proof.variants[1].id, quantity: 1 },
    { merchandiseId: proof.variants[2].id, quantity: 2 },
]);
const addedLines = added.cart.lines.nodes;
const distinctVariants = new Set(addedLines.map(line => line.merchandise.id));

if (added.cart.id !== createdCartId || added.cart.totalQuantity !== 5 || distinctVariants.size !== 3) {
    throw new Error("Multi-line cart proof did not produce one cart, three distinct lines, and total quantity five.");
}

const updated = await manager.updateLines([{ id: addedLines[0].id, quantity: 3 }]);
if (updated.cart.totalQuantity !== 6) {
    throw new Error("Cart line update proof failed.");
}

const removableLine = updated.cart.lines.nodes.at(-1);
const removed = await manager.removeLines([removableLine.id]);
if (removed.cart.totalQuantity >= updated.cart.totalQuantity) {
    throw new Error("Cart line removal proof failed.");
}

const checkoutUrl = await manager.getCheckoutUrl();
const remainingLineIds = removed.cart.lines.nodes.map(line => line.id);
if (remainingLineIds.length) {
    await manager.removeLines(remainingLineIds);
}
manager.clearCartReference();

console.log(JSON.stringify({
    cartCreate: created.cart.id === read.id,
    cartRead: read.id === createdCartId,
    cartLinesAdd: true,
    cartLinesUpdate: true,
    cartLinesRemove: true,
    checkoutUrl: checkoutUrl.startsWith("https://"),
    oneCart: added.cart.id === createdCartId,
    distinctLines: distinctVariants.size,
    totalQuantity: added.cart.totalQuantity,
    sameProduct: proof.sameProduct,
    proofProduct: proof.productTitle,
    warnings: added.warnings.map(warning => warning.code),
}, null, 2));
