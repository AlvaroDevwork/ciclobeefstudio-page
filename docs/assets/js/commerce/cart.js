import { STOREFRONT_CONFIG } from "./config.js";
import {
    COMMERCE_ERROR_CODES,
    CommerceError,
    createStorefrontClient,
} from "./storefront-client.js";

function createStorageAdapter(storage) {
    const fallback = new Map();

    return Object.freeze({
        getItem(key) {
            try {
                return storage?.getItem(key) ?? fallback.get(key) ?? null;
            } catch {
                return fallback.get(key) ?? null;
            }
        },
        setItem(key, value) {
            fallback.set(key, value);
            try {
                storage?.setItem(key, value);
            } catch {
                // In-memory persistence keeps the current session functional.
            }
        },
        removeItem(key) {
            fallback.delete(key);
            try {
                storage?.removeItem(key);
            } catch {
                // The fallback reference has already been cleared.
            }
        },
    });
}

function validateAddLines(lines) {
    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 250) {
        throw new CommerceError(COMMERCE_ERROR_CODES.INVALID_QUANTITY, "Between 1 and 250 cart lines are required.");
    }

    return lines.map(line => {
        const quantity = Number(line.quantity);
        if (!line.merchandiseId?.startsWith("gid://shopify/ProductVariant/") || !Number.isInteger(quantity) || quantity < 1) {
            throw new CommerceError(COMMERCE_ERROR_CODES.INVALID_QUANTITY, "Each cart line requires a valid variant and positive integer quantity.");
        }
        return Object.freeze({ merchandiseId: line.merchandiseId, quantity });
    });
}

function validateUpdateLines(lines) {
    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 250) {
        throw new CommerceError(COMMERCE_ERROR_CODES.INVALID_QUANTITY, "Between 1 and 250 line updates are required.");
    }

    return lines.map(line => {
        const quantity = Number(line.quantity);
        if (!line.id?.startsWith("gid://shopify/CartLine/") || !Number.isInteger(quantity) || quantity < 1) {
            throw new CommerceError(COMMERCE_ERROR_CODES.INVALID_QUANTITY, "Each update requires a valid cart line and positive integer quantity.");
        }
        return Object.freeze({ id: line.id, quantity });
    });
}

function validateLineIds(lineIds) {
    const uniqueIds = [...new Set(lineIds ?? [])];
    if (!uniqueIds.length || uniqueIds.length > 250 || uniqueIds.some(id => !id?.startsWith("gid://shopify/CartLine/"))) {
        throw new CommerceError(COMMERCE_ERROR_CODES.INVALID_CART, "Between 1 and 250 valid cart line IDs are required.");
    }
    return uniqueIds;
}

function validateCheckoutUrl(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password) {
            throw new Error("Unsafe checkout URL");
        }
        return url.href;
    } catch (error) {
        throw new CommerceError(COMMERCE_ERROR_CODES.INVALID_CART, "The cart did not provide a valid checkout URL.", { cause: error });
    }
}

export function createCartManager({
    client = createStorefrontClient(),
    storage = globalThis.localStorage,
    config = STOREFRONT_CONFIG,
} = {}) {
    const cartStorage = createStorageAdapter(storage);
    let mutationQueue = Promise.resolve();

    function enqueue(operation) {
        const result = mutationQueue.then(operation, operation);
        mutationQueue = result.catch(() => undefined);
        return result;
    }

    function clearCartReference() {
        cartStorage.removeItem(config.cartStorageKey);
    }

    function readCartReference() {
        const value = cartStorage.getItem(config.cartStorageKey);
        if (!value) return null;

        try {
            const reference = JSON.parse(value);
            if (reference.version !== config.cartStorageVersion || typeof reference.id !== "string" || !reference.id.startsWith("gid://shopify/Cart/")) {
                throw new Error("Invalid cart reference");
            }
            return reference.id;
        } catch {
            clearCartReference();
            return null;
        }
    }

    function persistCartReference(id) {
        cartStorage.setItem(config.cartStorageKey, JSON.stringify({
            version: config.cartStorageVersion,
            id,
        }));
    }

    async function createCartInternal(lines = []) {
        const result = await client.createCart(lines);
        persistCartReference(result.cart.id);
        return result;
    }

    async function getCartInternal() {
        const id = readCartReference();
        if (!id) return null;

        try {
            return await client.getCart(id);
        } catch (error) {
            if (error.code === COMMERCE_ERROR_CODES.INVALID_CART) {
                clearCartReference();
                return null;
            }
            throw error;
        }
    }

    async function ensureCartInternal() {
        const cart = await getCartInternal();
        if (cart) return Object.freeze({ cart, warnings: Object.freeze([]) });
        return createCartInternal();
    }

    return Object.freeze({
        getCart: () => enqueue(getCartInternal),
        ensureCart: () => enqueue(ensureCartInternal),
        addLines(lines) {
            const validatedLines = validateAddLines(lines);
            return enqueue(async () => {
                const current = await ensureCartInternal();
                try {
                    return await client.addCartLines(current.cart.id, validatedLines);
                } catch (error) {
                    if (error.code !== COMMERCE_ERROR_CODES.INVALID_CART) throw error;
                    clearCartReference();
                    return createCartInternal(validatedLines);
                }
            });
        },
        updateLines(lines) {
            const validatedLines = validateUpdateLines(lines);
            return enqueue(async () => {
                const current = await getCartInternal();
                if (!current) throw new CommerceError(COMMERCE_ERROR_CODES.INVALID_CART, "No active cart is available.");
                return client.updateCartLines(current.id, validatedLines);
            });
        },
        removeLines(lineIds) {
            const validatedIds = validateLineIds(lineIds);
            return enqueue(async () => {
                const current = await getCartInternal();
                if (!current) throw new CommerceError(COMMERCE_ERROR_CODES.INVALID_CART, "No active cart is available.");
                return client.removeCartLines(current.id, validatedIds);
            });
        },
        getCheckoutUrl() {
            return enqueue(async () => {
                const cart = await getCartInternal();
                if (!cart) throw new CommerceError(COMMERCE_ERROR_CODES.INVALID_CART, "No active cart is available.");
                return validateCheckoutUrl(cart.checkoutUrl);
            });
        },
        clearCartReference,
        diagnostics: Object.freeze({
            storageKey: config.cartStorageKey,
            storageVersion: config.cartStorageVersion,
            mutationSerialization: "PROMISE_QUEUE",
        }),
    });
}
