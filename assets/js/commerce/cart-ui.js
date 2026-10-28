import { createCartManager } from "./cart.js";
import { isLocalCommerceQaEnabled } from "./config.js";
import { COMMERCE_ERROR_CODES } from "./storefront-client.js";

function element(documentRef, tagName, { className, text, attributes = {} } = {}) {
    const node = documentRef.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, String(value)));
    return node;
}

function trashIcon(documentRef) {
    const namespace = "http://www.w3.org/2000/svg";
    const createSvgElement = tagName => typeof documentRef.createElementNS === "function"
        ? documentRef.createElementNS(namespace, tagName)
        : documentRef.createElement(tagName);
    const svg = createSvgElement("svg");
    const path = createSvgElement("path");
    Object.entries({
        class: "cbs-cart-line__remove-icon",
        viewBox: "0 0 24 24",
        width: "20",
        height: "20",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.8",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "aria-hidden": "true",
        focusable: "false",
    }).forEach(([name, value]) => svg.setAttribute(name, value));
    path.setAttribute("d", "M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5");
    svg.append(path);
    return svg;
}

function safeImageUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" ? url.href : null;
    } catch {
        return null;
    }
}

function formatMoney(money) {
    if (!money?.currencyCode || !Number.isFinite(Number(money.amount))) return "—";
    try {
        return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: money.currencyCode,
        }).format(Number(money.amount));
    } catch {
        return `${money.currencyCode} ${money.amount}`;
    }
}

function customerErrorMessage(error) {
    switch (error?.code) {
        case COMMERCE_ERROR_CODES.NETWORK_ERROR:
            return "We couldn’t reach the cart. Check your connection and try again.";
        case COMMERCE_ERROR_CODES.INVALID_CART:
            return "Your saved cart is no longer available. Reopen the cart to continue.";
        case COMMERCE_ERROR_CODES.INVALID_VARIANT:
        case COMMERCE_ERROR_CODES.UNAVAILABLE_VARIANT:
            return "One of these items is no longer available. Review your cart and try again.";
        case COMMERCE_ERROR_CODES.INVALID_QUANTITY:
            return "That quantity is not available. Review the item quantity and try again.";
        default:
            return "Your cart couldn’t be updated. Please try again.";
    }
}

function quantityRuleFor(line) {
    const rule = line.merchandise?.quantityRule ?? {};
    return Object.freeze({
        minimum: Number.isInteger(rule.minimum) && rule.minimum > 0 ? rule.minimum : 1,
        maximum: Number.isInteger(rule.maximum) && rule.maximum > 0 ? rule.maximum : null,
        increment: Number.isInteger(rule.increment) && rule.increment > 0 ? rule.increment : 1,
    });
}

function focusableElements(container) {
    return Array.from(container.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter(node => !node.hidden && node.getAttribute("aria-hidden") !== "true");
}

export function isCbsCartQaEnabled(locationRef = window.location) {
    return isLocalCommerceQaEnabled(locationRef);
}

export function createCartUiController({
    manager = createCartManager(),
    documentRef = document,
    navigate = url => window.location.assign(url),
} = {}) {
    let currentCart = null;
    let busy = false;
    let open = false;
    let hydrated = false;
    let pendingRefreshes = 0;
    let refreshQueue = Promise.resolve();
    let returnFocus = null;

    const root = element(documentRef, "div", { className: "cbs-cart-qa" });
    const launcher = element(documentRef, "button", {
        className: "cbs-cart-qa__launcher",
        text: "CBS Cart QA",
        attributes: { type: "button", "aria-haspopup": "dialog", "aria-controls": "cbs-cart-panel" },
    });
    const badge = element(documentRef, "span", {
        className: "cbs-cart-qa__badge",
        text: "0",
        attributes: { "aria-hidden": "true" },
    });
    launcher.append(badge);

    const backdrop = element(documentRef, "div", {
        className: "cbs-cart__backdrop",
        attributes: { "aria-hidden": "true" },
    });
    backdrop.hidden = true;

    const panel = element(documentRef, "aside", {
        className: "cbs-cart",
        attributes: {
            id: "cbs-cart-panel",
            role: "dialog",
            "aria-modal": "true",
            "aria-labelledby": "cbs-cart-title",
            "aria-hidden": "true",
            tabindex: "-1",
        },
    });
    panel.hidden = true;

    const header = element(documentRef, "header", { className: "cbs-cart__header" });
    const title = element(documentRef, "h2", { text: "Your Cart", attributes: { id: "cbs-cart-title" } });
    const closeButton = element(documentRef, "button", {
        className: "cbs-cart__icon-button",
        text: "×",
        attributes: { type: "button", "aria-label": "Close cart" },
    });
    header.append(title, closeButton);

    const status = element(documentRef, "p", {
        className: "cbs-cart__status",
        attributes: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
    });
    const content = element(documentRef, "div", { className: "cbs-cart__content" });
    const footer = element(documentRef, "footer", { className: "cbs-cart__footer" });
    const subtotalRow = element(documentRef, "div", { className: "cbs-cart__subtotal" });
    const subtotalLabel = element(documentRef, "span", { text: "Subtotal" });
    const subtotalValue = element(documentRef, "strong", { text: "—" });
    subtotalRow.append(subtotalLabel, subtotalValue);
    const checkoutButton = element(documentRef, "button", {
        className: "cbs-cart__checkout",
        text: "Secure Checkout",
        attributes: { type: "button" },
    });
    const continueButton = element(documentRef, "button", {
        className: "cbs-cart__continue",
        text: "Continue Shopping",
        attributes: { type: "button" },
    });
    footer.append(subtotalRow, checkoutButton, continueButton);
    panel.append(header, status, content, footer);
    root.append(launcher, backdrop, panel);
    documentRef.body.append(root);

    function setCartCount(totalQuantity = 0) {
        const count = Math.max(0, Number(totalQuantity) || 0);
        badge.textContent = String(count);
        badge.hidden = count === 0;
        launcher.setAttribute("aria-label", `Open Your Cart, ${count} ${count === 1 ? "item" : "items"}`);
    }

    function setBusy(nextBusy, message = "") {
        busy = nextBusy;
        panel.setAttribute("aria-busy", String(busy));
        status.textContent = message;
        render();
    }

    function renderEmptyState() {
        const empty = element(documentRef, "div", { className: "cbs-cart__empty" });
        empty.append(element(documentRef, "p", { text: "Your cart is empty." }));
        const browse = element(documentRef, "a", {
            text: "Browse Studio Store",
            attributes: { href: "#products" },
        });
        browse.addEventListener("click", closeCart);
        empty.append(browse);
        content.append(empty);
    }

    async function updateQuantity(line, quantity) {
        if (busy || quantity === line.quantity) return;
        setBusy(true, "Updating quantity…");
        try {
            const result = await manager.updateLines([{ id: line.id, quantity }]);
            currentCart = result.cart;
            status.textContent = result.warnings.length ? "Your cart was adjusted to current availability." : "Quantity updated.";
        } catch (error) {
            status.textContent = customerErrorMessage(error);
        } finally {
            busy = false;
            panel.setAttribute("aria-busy", "false");
            render();
        }
    }

    async function removeLine(line) {
        if (busy) return;
        setBusy(true, `Removing ${line.merchandise?.product?.title ?? "item"}…`);
        try {
            const result = await manager.removeLines([line.id]);
            currentCart = result.cart;
            status.textContent = result.warnings.length ? "Your cart was adjusted to current availability." : "Item removed.";
        } catch (error) {
            status.textContent = customerErrorMessage(error);
        } finally {
            busy = false;
            panel.setAttribute("aria-busy", "false");
            render();
        }
    }

    function renderLine(line) {
        const merchandise = line.merchandise ?? {};
        const productTitle = merchandise.product?.title ?? "Studio item";
        const rule = quantityRuleFor(line);
        const canUpdate = merchandise.availableForSale !== false
            && line.instructions?.canUpdateQuantity !== false;
        const canRemove = line.instructions?.canRemove !== false;
        const article = element(documentRef, "article", {
            className: "cbs-cart-line",
            attributes: { "aria-label": productTitle },
        });
        const imageUrl = safeImageUrl(merchandise.image?.url);
        if (imageUrl) {
            const image = element(documentRef, "img", {
                className: "cbs-cart-line__image",
                attributes: {
                    src: imageUrl,
                    alt: merchandise.image?.altText || productTitle,
                    width: merchandise.image?.width || 96,
                    height: merchandise.image?.height || 96,
                    loading: "lazy",
                    decoding: "async",
                },
            });
            article.append(image);
        }

        const details = element(documentRef, "div", { className: "cbs-cart-line__details" });
        details.append(element(documentRef, "h3", { text: productTitle }));
        const selectedOptions = (merchandise.selectedOptions ?? [])
            .filter(option => option.value && option.value !== "Default Title");
        if (selectedOptions.length) {
            const options = element(documentRef, "dl", { className: "cbs-cart-line__options" });
            selectedOptions.forEach(option => {
                options.append(
                    element(documentRef, "dt", { text: option.name }),
                    element(documentRef, "dd", { text: option.value }),
                );
            });
            details.append(options);
        }

        const quantity = element(documentRef, "div", {
            className: "cbs-cart-line__quantity",
            attributes: { role: "group", "aria-label": `Quantity for ${productTitle}` },
        });
        const decreaseValue = line.quantity - rule.increment;
        const increaseValue = line.quantity + rule.increment;
        const decrease = element(documentRef, "button", {
            text: "−",
            attributes: { type: "button", "aria-label": `Decrease quantity for ${productTitle}` },
        });
        decrease.disabled = busy || !canUpdate || decreaseValue < rule.minimum;
        decrease.addEventListener("click", () => updateQuantity(line, decreaseValue));
        const quantityValue = element(documentRef, "output", {
            text: String(line.quantity),
            attributes: { "aria-label": `Quantity ${line.quantity}` },
        });
        const increase = element(documentRef, "button", {
            text: "+",
            attributes: { type: "button", "aria-label": `Increase quantity for ${productTitle}` },
        });
        increase.disabled = busy || !canUpdate || (rule.maximum !== null && increaseValue > rule.maximum);
        increase.addEventListener("click", () => updateQuantity(line, increaseValue));
        quantity.append(decrease, quantityValue, increase);
        details.append(quantity);

        const actions = element(documentRef, "div", { className: "cbs-cart-line__actions" });
        actions.append(element(documentRef, "strong", {
            className: "cbs-cart-line__price",
            text: formatMoney(line.cost?.totalAmount),
        }));
        const optionSummary = selectedOptions.map(option => option.value).join(" / ");
        const removeDescription = [productTitle, optionSummary].filter(Boolean).join(" / ");
        const remove = element(documentRef, "button", {
            className: "cbs-cart-line__remove",
            attributes: { type: "button", "aria-label": `Remove ${removeDescription} from cart` },
        });
        remove.append(trashIcon(documentRef));
        remove.disabled = busy || !canRemove;
        remove.addEventListener("click", () => removeLine(line));
        actions.append(remove);
        details.append(actions);
        article.append(details);
        return article;
    }

    function render() {
        content.replaceChildren();
        setCartCount(currentCart?.totalQuantity ?? 0);
        const lines = currentCart?.lines?.nodes ?? [];

        if (busy && !currentCart) {
            content.append(element(documentRef, "p", { className: "cbs-cart__message", text: "Loading your cart…" }));
        } else if (!lines.length) {
            renderEmptyState();
        } else {
            const list = element(documentRef, "div", {
                className: "cbs-cart__lines",
                attributes: { role: "list" },
            });
            lines.forEach(line => {
                const item = renderLine(line);
                item.setAttribute("role", "listitem");
                list.append(item);
            });
            content.append(list);
        }

        subtotalValue.textContent = formatMoney(currentCart?.cost?.subtotalAmount);
        checkoutButton.disabled = busy || !lines.length;
    }

    function refreshCart() {
        pendingRefreshes += 1;
        setBusy(true, "Loading your cart…");
        const operation = refreshQueue.then(async () => {
            try {
                currentCart = await manager.getCart();
                status.textContent = "";
            } catch (error) {
                currentCart = null;
                status.textContent = customerErrorMessage(error);
            } finally {
                hydrated = true;
                pendingRefreshes -= 1;
                busy = pendingRefreshes > 0;
                panel.setAttribute("aria-busy", String(busy));
                render();
            }
            return currentCart;
        });
        refreshQueue = operation.catch(() => undefined);
        return operation;
    }

    async function openCart(event, { refresh = !hydrated } = {}) {
        if (open) return;
        open = true;
        returnFocus = event?.currentTarget ?? documentRef.activeElement;
        if (refresh) await refreshCart();
        backdrop.hidden = false;
        panel.hidden = false;
        panel.setAttribute("aria-hidden", "false");
        documentRef.body.classList.add("cbs-cart-is-open");
        closeButton.focus({ preventScroll: true });
    }

    function closeCart() {
        if (!open) return;
        open = false;
        backdrop.hidden = true;
        panel.hidden = true;
        panel.setAttribute("aria-hidden", "true");
        documentRef.body.classList.remove("cbs-cart-is-open");
        returnFocus?.focus?.({ preventScroll: true });
        returnFocus = null;
    }

    async function checkout() {
        if (busy || !currentCart?.lines?.nodes?.length) return;
        setBusy(true, "Preparing secure checkout…");
        try {
            navigate(await manager.getCheckoutUrl());
        } catch (error) {
            busy = false;
            panel.setAttribute("aria-busy", "false");
            status.textContent = customerErrorMessage(error);
            render();
        }
    }

    function handlePanelKeydown(event) {
        if (event.key === "Escape") {
            event.preventDefault();
            closeCart();
            return;
        }
        if (event.key !== "Tab") return;
        const focusable = focusableElements(panel);
        if (!focusable.length) {
            event.preventDefault();
            panel.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && documentRef.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && documentRef.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    launcher.addEventListener("click", openCart);
    closeButton.addEventListener("click", closeCart);
    continueButton.addEventListener("click", closeCart);
    backdrop.addEventListener("click", closeCart);
    checkoutButton.addEventListener("click", checkout);
    panel.addEventListener("keydown", handlePanelKeydown);
    render();

    return Object.freeze({
        open: openCart,
        close: closeCart,
        refresh: refreshCart,
        getSnapshot: () => Object.freeze({
            isOpen: open,
            isBusy: busy,
            totalQuantity: currentCart?.totalQuantity ?? 0,
            lineCount: currentCart?.lines?.nodes?.length ?? 0,
        }),
    });
}

export function initializeQaCart({
    locationRef = window.location,
    windowRef = window,
    documentRef = document,
    manager = createCartManager(),
} = {}) {
    if (!isCbsCartQaEnabled(locationRef)) return null;
    if (windowRef.CBSCartQA) return windowRef.CBSCartQA;

    const controller = createCartUiController({ manager, documentRef });
    const ready = controller.refresh();
    windowRef.CBSCartQA = Object.freeze({
        open: controller.open,
        close: controller.close,
        refresh: controller.refresh,
        getSnapshot: controller.getSnapshot,
        ready,
    });
    return windowRef.CBSCartQA;
}

if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeQaCart, { once: true });
    } else {
        initializeQaCart();
    }
}
