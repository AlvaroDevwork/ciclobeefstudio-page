import { STOREFRONT_CONFIG } from "./config.js";
import {
    CART_CREATE_MUTATION,
    CART_LINES_ADD_MUTATION,
    CART_LINES_REMOVE_MUTATION,
    CART_LINES_UPDATE_MUTATION,
    CART_QUERY,
    PRODUCT_VARIANTS_QUERY,
} from "./storefront-operations.js";

export const COMMERCE_ERROR_CODES = Object.freeze({
    NETWORK_ERROR: "NETWORK_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    CART_USER_ERROR: "CART_USER_ERROR",
    INVALID_CART: "INVALID_CART",
    INVALID_VARIANT: "INVALID_VARIANT",
    UNAVAILABLE_VARIANT: "UNAVAILABLE_VARIANT",
    INVALID_QUANTITY: "INVALID_QUANTITY",
    UNKNOWN_COMMERCE_ERROR: "UNKNOWN_COMMERCE_ERROR",
});

export class CommerceError extends Error {
    constructor(code, message, options = {}) {
        super(message, options.cause ? { cause: options.cause } : undefined);
        this.name = "CommerceError";
        this.code = code;
        this.details = options.details ?? null;
    }
}

function classifyCartUserError(error) {
    const source = `${error.code ?? ""} ${(error.field ?? []).join(" ")} ${error.message ?? ""}`.toUpperCase();

    if (source.includes("CART") && (source.includes("INVALID") || source.includes("NOT FOUND") || source.includes("DOES NOT EXIST"))) {
        return COMMERCE_ERROR_CODES.INVALID_CART;
    }
    if (source.includes("QUANTITY") || source.includes("MINIMUM") || source.includes("MAXIMUM") || source.includes("INCREMENT")) {
        return COMMERCE_ERROR_CODES.INVALID_QUANTITY;
    }
    if (source.includes("OUT_OF_STOCK") || source.includes("OUT OF STOCK") || source.includes("UNAVAILABLE")) {
        return COMMERCE_ERROR_CODES.UNAVAILABLE_VARIANT;
    }
    if (source.includes("MERCHANDISE") || source.includes("VARIANT")) {
        return COMMERCE_ERROR_CODES.INVALID_VARIANT;
    }
    return COMMERCE_ERROR_CODES.CART_USER_ERROR;
}

function assertMutationResult(result, operationName) {
    const userErrors = result?.userErrors ?? [];

    if (userErrors.length) {
        throw new CommerceError(
            classifyCartUserError(userErrors[0]),
            `Commerce operation ${operationName} was rejected.`,
            { details: userErrors },
        );
    }
    if (!result?.cart) {
        throw new CommerceError(
            COMMERCE_ERROR_CODES.INVALID_CART,
            `Commerce operation ${operationName} did not return a cart.`,
        );
    }

    return Object.freeze({
        cart: result.cart,
        warnings: Object.freeze([...(result.warnings ?? [])]),
    });
}

export function createStorefrontClient({
    config = STOREFRONT_CONFIG,
    fetchImpl = globalThis.fetch,
} = {}) {
    if (typeof fetchImpl !== "function") {
        throw new CommerceError(COMMERCE_ERROR_CODES.NETWORK_ERROR, "A fetch implementation is required.");
    }

    async function request(query, variables, operationName) {
        let response;

        try {
            response = await fetchImpl(config.endpoint, {
                method: "POST",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "X-Shopify-Storefront-Access-Token": config.publicAccessToken,
                },
                body: JSON.stringify({ query, variables, operationName }),
            });
        } catch (error) {
            throw new CommerceError(COMMERCE_ERROR_CODES.NETWORK_ERROR, "The commerce service could not be reached.", { cause: error });
        }

        if (!response.ok) {
            throw new CommerceError(
                COMMERCE_ERROR_CODES.NETWORK_ERROR,
                `The commerce service returned HTTP ${response.status}.`,
                { details: { status: response.status } },
            );
        }

        let payload;
        try {
            payload = await response.json();
        } catch (error) {
            throw new CommerceError(
                COMMERCE_ERROR_CODES.UNKNOWN_COMMERCE_ERROR,
                "The commerce service returned an unreadable response.",
                { cause: error, details: { status: response.status } },
            );
        }
        if (payload.errors?.length) {
            throw new CommerceError(
                COMMERCE_ERROR_CODES.GRAPHQL_ERROR,
                `Commerce operation ${operationName} failed.`,
                { details: payload.errors },
            );
        }

        return payload.data;
    }

    return Object.freeze({
        async getCart(id) {
            const data = await request(CART_QUERY, { id }, "CbsCart");
            if (!data.cart) {
                throw new CommerceError(COMMERCE_ERROR_CODES.INVALID_CART, "The saved cart is no longer available.");
            }
            return data.cart;
        },
        async createCart(lines = []) {
            const data = await request(CART_CREATE_MUTATION, { input: lines.length ? { lines } : {} }, "CbsCartCreate");
            return assertMutationResult(data.cartCreate, "cartCreate");
        },
        async addCartLines(cartId, lines) {
            const data = await request(CART_LINES_ADD_MUTATION, { cartId, lines }, "CbsCartLinesAdd");
            return assertMutationResult(data.cartLinesAdd, "cartLinesAdd");
        },
        async updateCartLines(cartId, lines) {
            const data = await request(CART_LINES_UPDATE_MUTATION, { cartId, lines }, "CbsCartLinesUpdate");
            return assertMutationResult(data.cartLinesUpdate, "cartLinesUpdate");
        },
        async removeCartLines(cartId, lineIds) {
            const data = await request(CART_LINES_REMOVE_MUTATION, { cartId, lineIds }, "CbsCartLinesRemove");
            return assertMutationResult(data.cartLinesRemove, "cartLinesRemove");
        },
        async getProductVariants(productId, { first = 100, after = null } = {}) {
            const data = await request(PRODUCT_VARIANTS_QUERY, { id: productId, first, after }, "CbsProductVariants");
            if (!data.product) {
                throw new CommerceError(COMMERCE_ERROR_CODES.INVALID_VARIANT, "The requested product is not available.");
            }
            return data.product;
        },
        diagnostics: Object.freeze({
            apiVersion: config.apiVersion,
            endpoint: config.endpoint,
            authentication: "PUBLIC_STOREFRONT_ACCESS_TOKEN",
        }),
    });
}
