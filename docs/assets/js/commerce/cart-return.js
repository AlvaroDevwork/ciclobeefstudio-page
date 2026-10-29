import { openExistingShopifyCart } from "./shopify-buy.js";

const status = document.querySelector("[data-cart-return-status]");
const fallback = document.querySelector("[data-cart-return-fallback]");

function showFallback(message) {
    status.textContent = message;
    fallback.hidden = false;
}

async function initializeCartReturn() {
    const result = await openExistingShopifyCart();

    if (result.status === "opened") {
        status.textContent = "Your cart is open and ready to review.";
        return;
    }

    if (result.status === "empty" || result.status === "missing") {
        showFallback("There isn’t an active cart to restore on this device.");
        return;
    }

    showFallback("Your cart is temporarily unavailable. You can return to the Studio Store and try again.");
}

initializeCartReturn();
