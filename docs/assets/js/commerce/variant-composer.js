import { createCartManager } from "./cart.js";
import { isLocalCommerceQaEnabled } from "./config.js";
import { createProductOptionsService, PRODUCT_PURCHASE_MODES } from "./product-options.js";
import { COMMERCE_ERROR_CODES } from "./storefront-client.js";

const MAX_CONFIGURABLE_UNITS = 99;

function element(documentRef, tagName, { className, text, attributes = {} } = {}) {
    const node = documentRef.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, String(value)));
    return node;
}

function formatMoney(money) {
    if (!money?.currencyCode || money.amount === null || !Number.isFinite(Number(money.amount))) return "—";
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
            return "We couldn’t reach the store. Check your connection and try again.";
        case COMMERCE_ERROR_CODES.INVALID_VARIANT:
        case COMMERCE_ERROR_CODES.UNAVAILABLE_VARIANT:
            return "One of these options is no longer available. Review your selections and try again.";
        case COMMERCE_ERROR_CODES.INVALID_QUANTITY:
            return "One of the selected quantities is not available. Review your set and try again.";
        default:
            return "Your selections couldn’t be added. Please try again.";
    }
}

function isDefaultOption(option) {
    return option.name === "Default Title" || option.value === "Default Title";
}

function clampInteger(value, minimum, maximum) {
    const bounded = Math.max(minimum, Math.round(Number(value) || minimum));
    return maximum === null ? bounded : Math.min(bounded, maximum);
}

function optionNamesFor(configuration) {
    return configuration.optionNames ?? [];
}

function optionValuesFor(configuration, optionName) {
    const values = [];
    configuration.purchasableVariants.forEach(variant => {
        variant.selectedOptions.forEach(option => {
            if (option.name === optionName && option.value && !values.includes(option.value)) {
                values.push(option.value);
            }
        });
    });
    return values;
}

function findVariantByOptions(configuration, options) {
    const names = optionNamesFor(configuration);
    if (!names.length) return configuration.purchasableVariants[0] ?? null;

    return configuration.purchasableVariants.find(variant => {
        return names.every(name => {
            const expected = options[name];
            if (!expected) return false;
            const actual = variant.selectedOptions.find(option => option.name === name);
            return actual && actual.value === expected;
        });
    }) ?? null;
}

function groupLinesByVariant(lines) {
    const grouped = new Map();
    lines.forEach(line => {
        const current = grouped.get(line.merchandiseId);
        grouped.set(line.merchandiseId, (current ?? 0) + line.quantity);
    });
    return [...grouped.entries()].map(([merchandiseId, quantity]) => ({ merchandiseId, quantity }));
}

export function createComposerSelection(configuration) {
    const mode = configuration.purchaseMode;
    const simpleMode = mode === PRODUCT_PURCHASE_MODES.SIMPLE;
    const purchasable = configuration.purchasableVariants;

    let simpleQuantity = simpleMode && purchasable[0] ? purchasable[0].quantityRule.minimum : 0;
    let unitCount = simpleMode ? 0 : 1;
    let units = simpleMode ? [] : [{}];

    function reset() {
        if (simpleMode) {
            simpleQuantity = purchasable[0] ? purchasable[0].quantityRule.minimum : 0;
            unitCount = 0;
            units = [];
            return;
        }
        unitCount = 1;
        units = [{}];
    }

    function setUnitCount(value) {
        if (simpleMode) return;
        const next = clampInteger(value, 1, MAX_CONFIGURABLE_UNITS);
        const resized = units.slice(0, next);
        while (resized.length < next) resized.push({});
        unitCount = next;
        units = resized;
    }

    function setSimpleQuantity(value) {
        if (!simpleMode || !purchasable[0]) return;
        simpleQuantity = clampInteger(value, 0, purchasable[0].quantityRule.maximum ?? MAX_CONFIGURABLE_UNITS);
        if (purchasable[0].quantityRule.minimum > 1 && simpleQuantity === 0) {
            simpleQuantity = purchasable[0].quantityRule.minimum;
        }
    }

    function increase() {
        if (simpleMode) {
            setSimpleQuantity(simpleQuantity + (purchasable[0]?.quantityRule.increment ?? 1));
        } else {
            setUnitCount(unitCount + 1);
        }
    }

    function decrease() {
        if (simpleMode) {
            const minimum = purchasable[0]?.quantityRule.minimum ?? 1;
            const step = purchasable[0]?.quantityRule.increment ?? 1;
            const next = simpleQuantity - step;
            setSimpleQuantity(next < minimum ? (minimum === 1 ? 0 : minimum) : next);
        } else {
            setUnitCount(unitCount - 1);
        }
    }

    function setOption(unitIndex, optionName, value) {
        if (simpleMode) return;
        const unit = units[unitIndex];
        if (!unit) return;
        units[unitIndex] = { ...unit, [optionName]: value };
    }

    function resolveUnit(unitIndex) {
        if (simpleMode) return purchasable[0] ?? null;
        const unit = units[unitIndex];
        if (!unit) return null;
        return findVariantByOptions(configuration, unit);
    }

    function getQuantity() {
        return simpleMode ? simpleQuantity : unitCount;
    }

    function getTotal() {
        return simpleMode ? simpleQuantity : unitCount;
    }

    function isComplete() {
        if (simpleMode) return simpleQuantity > 0;
        if (unitCount === 0) return false;
        return units.every((_, index) => resolveUnit(index) !== null);
    }

    function getUnresolvedUnitIndexes() {
        if (simpleMode) return [];
        return units.map((_, index) => index).filter(index => resolveUnit(index) === null);
    }

    function getLines() {
        if (simpleMode) {
            return simpleQuantity > 0 && purchasable[0]
                ? [{ merchandiseId: purchasable[0].id, quantity: simpleQuantity }]
                : [];
        }
        const resolved = units.map((_, index) => resolveUnit(index)).filter(Boolean);
        return groupLinesByVariant(resolved.map(variant => ({ merchandiseId: variant.id, quantity: 1 })));
    }

    reset();

    return Object.freeze({
        mode,
        isSimple: simpleMode,
        getQuantity,
        getTotal,
        setQuantity: simpleMode ? setSimpleQuantity : setUnitCount,
        increase,
        decrease,
        setOption,
        getOptions: unitIndex => (simpleMode ? {} : { ...(units[unitIndex] ?? {}) }),
        resolveUnit,
        isComplete,
        getUnresolvedUnitIndexes,
        getLines,
        getUnitCount: () => (simpleMode ? 0 : unitCount),
        reset,
    });
}

export function createComposerSubmission({ configuration, manager, onAdded = () => undefined }) {
    const selection = createComposerSelection(configuration);
    let activeSubmission = null;

    return Object.freeze({
        selection,
        isBusy: () => activeSubmission !== null,
        submit() {
            if (activeSubmission) return activeSubmission;
            if (!selection.isComplete()) {
                const error = new Error("Every item must be configured before adding to cart.");
                error.code = COMMERCE_ERROR_CODES.INVALID_VARIANT;
                return Promise.reject(error);
            }
            const lines = selection.getLines();
            if (!lines.length) {
                const error = new Error("At least one item must be selected.");
                error.code = COMMERCE_ERROR_CODES.INVALID_QUANTITY;
                return Promise.reject(error);
            }

            activeSubmission = (async () => {
                const result = await manager.addLines(lines);
                selection.reset();
                await onAdded(result);
                return result;
            })().finally(() => {
                activeSubmission = null;
            });
            return activeSubmission;
        },
    });
}

function focusableElements(container) {
    return Array.from(container.querySelectorAll(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"]), select:not([disabled])',
    )).filter(node => !node.hidden && node.getAttribute("aria-hidden") !== "true");
}

function renderQuantityStepper(documentRef, { value, minimum = 1, onDecrease, onIncrease, disabled, label }) {
    const group = element(documentRef, "div", {
        className: "cbs-composer__quantity",
        attributes: { role: "group", "aria-label": `Quantity for ${label}` },
    });
    const decrease = element(documentRef, "button", {
        text: "−",
        attributes: { type: "button", "aria-label": `Decrease quantity` },
    });
    const output = element(documentRef, "output", {
        text: String(value),
        attributes: { "aria-label": `Quantity ${value}` },
    });
    const increase = element(documentRef, "button", {
        text: "+",
        attributes: { type: "button", "aria-label": `Increase quantity` },
    });
    decrease.disabled = disabled || value <= minimum;
    increase.disabled = disabled || value >= MAX_CONFIGURABLE_UNITS;
    decrease.addEventListener("click", onDecrease);
    increase.addEventListener("click", onIncrease);
    group.append(decrease, output, increase);
    return group;
}

function renderUnitOptions(documentRef, { unitIndex, configuration, selection, disabled, onChange }) {
    const names = optionNamesFor(configuration);
    const container = element(documentRef, "div", { className: "cbs-composer__unit-options" });
    const currentOptions = selection.getOptions(unitIndex);

    names.forEach(name => {
        const values = optionValuesFor(configuration, name);
        const field = element(documentRef, "label", { className: "cbs-composer__option" });
        field.append(element(documentRef, "span", { className: "cbs-composer__option-label", text: name }));
        const select = element(documentRef, "select", {
            attributes: { "aria-label": `${name} for item ${unitIndex + 1}` },
        });
        select.disabled = disabled;
        const placeholder = element(documentRef, "option", {
            text: `Select ${name}`,
            attributes: { value: "" },
        });
        select.append(placeholder);
        values.forEach(value => {
            const option = element(documentRef, "option", { text: value, attributes: { value } });
            select.append(option);
        });
        select.value = currentOptions[name] ?? "";
        select.addEventListener("change", () => {
            selection.setOption(unitIndex, name, select.value);
            onChange();
        });
        field.append(select);
        container.append(field);
    });

    return container;
}

export function createVariantComposerController({
    documentRef = document,
    optionsService = createProductOptionsService(),
    manager = createCartManager(),
    cartController = () => globalThis.window?.CBSCartQA,
} = {}) {
    let activeProduct = null;
    let launcher = null;
    let configuration = null;
    let session = null;
    let loadSequence = 0;
    let loading = false;
    let adding = false;

    const root = element(documentRef, "div", { className: "cbs-composer-qa" });
    const backdrop = element(documentRef, "div", { className: "cbs-composer__backdrop", attributes: { "aria-hidden": "true" } });
    const dialog = element(documentRef, "section", {
        className: "cbs-composer",
        attributes: {
            id: "cbs-variant-composer",
            role: "dialog",
            "aria-modal": "true",
            "aria-labelledby": "cbs-composer-title",
            "aria-describedby": "cbs-composer-status",
            tabindex: "-1",
        },
    });
    const header = element(documentRef, "header", { className: "cbs-composer__header" });
    const heading = element(documentRef, "h2", { attributes: { id: "cbs-composer-title" } });
    const closeButton = element(documentRef, "button", {
        className: "cbs-composer__close",
        text: "×",
        attributes: { type: "button", "aria-label": "Close product options" },
    });
    header.append(heading, closeButton);
    const status = element(documentRef, "p", {
        className: "cbs-composer__status",
        attributes: { id: "cbs-composer-status", role: "status", "aria-live": "polite", "aria-atomic": "true" },
    });
    const content = element(documentRef, "div", { className: "cbs-composer__content" });
    const footer = element(documentRef, "footer", { className: "cbs-composer__footer" });
    const total = element(documentRef, "output", {
        className: "cbs-composer__total",
        attributes: { "aria-live": "polite", "aria-atomic": "true" },
    });
    const addButton = element(documentRef, "button", {
        className: "cbs-composer__add",
        text: "Add selected items",
        attributes: { type: "button" },
    });
    footer.append(total, addButton);
    dialog.append(header, status, content, footer);
    root.append(backdrop, dialog);
    root.hidden = true;
    documentRef.body.append(root);

    function refreshAddState() {
        const complete = session?.selection.isComplete() ?? false;
        addButton.disabled = loading || adding || !complete;
        addButton.textContent = configuration?.purchaseMode === PRODUCT_PURCHASE_MODES.SIMPLE
            ? "Add to cart"
            : `Add ${session?.selection.getQuantity() ?? 0} item${session?.selection.getQuantity() === 1 ? "" : "s"} to cart`;
        total.textContent = `Total pieces: ${session?.selection.getTotal() ?? 0}`;
    }

    function renderUnitList() {
        const names = optionNamesFor(configuration);
        const units = element(documentRef, "div", {
            className: "cbs-composer__units",
            attributes: { role: "list", "aria-label": `${configuration.title} items` },
        });
        const count = session.selection.getQuantity();

        for (let index = 0; index < count; index += 1) {
            const unit = element(documentRef, "article", {
                className: "cbs-composer__unit",
                attributes: { role: "listitem", "aria-label": `Item ${index + 1}` },
            });
            const headerNode = element(documentRef, "div", { className: "cbs-composer__unit-header" });
            headerNode.append(element(documentRef, "h3", { text: `Item ${index + 1}` }));

            const resolved = session.selection.resolveUnit(index);
            if (resolved && resolved.price) {
                headerNode.append(element(documentRef, "span", { className: "cbs-composer__price", text: formatMoney(resolved.price) }));
            } else if (names.length && Object.keys(session.selection.getOptions(index)).length) {
                headerNode.append(element(documentRef, "span", { className: "cbs-composer__unavailable", text: "Unavailable combination" }));
            }

            unit.append(headerNode);
            unit.append(renderUnitOptions(documentRef, {
                unitIndex: index,
                configuration,
                selection: session.selection,
                disabled: adding,
                onChange: refreshAddState,
            }));
            units.append(unit);
        }

        return units;
    }

    function renderConfiguration() {
        content.replaceChildren();
        if (!configuration || !session) return;
        closeButton.disabled = adding;

        if (
            configuration.purchaseMode === PRODUCT_PURCHASE_MODES.UNAVAILABLE
            || configuration.purchaseMode === PRODUCT_PURCHASE_MODES.UNSUPPORTED_REQUIRES_COMPONENTS
        ) {
            content.append(element(documentRef, "p", {
                className: "cbs-composer__message",
                text: "This product is currently unavailable.",
            }));
        } else if (configuration.purchaseMode === PRODUCT_PURCHASE_MODES.SIMPLE) {
            const variant = configuration.purchasableVariants[0];
            const simple = element(documentRef, "section", {
                className: "cbs-composer__simple",
                attributes: { "aria-label": "Choose quantity" },
            });
            simple.append(
                element(documentRef, "h3", { text: "Quantity" }),
                element(documentRef, "span", { className: "cbs-composer__price", text: formatMoney(variant.price) }),
                renderQuantityStepper(documentRef, {
                    value: session.selection.getQuantity(),
                    minimum: 0,
                    disabled: adding,
                    label: configuration.title,
                    onDecrease: () => { session.selection.decrease(); renderConfiguration(); },
                    onIncrease: () => { session.selection.increase(); renderConfiguration(); },
                }),
            );
            content.append(simple);
        } else {
            const buildSet = element(documentRef, "section", {
                className: "cbs-composer__build",
                attributes: { "aria-label": "Configure your set" },
            });
            const quantityBlock = element(documentRef, "div", { className: "cbs-composer__build-quantity" });
            quantityBlock.append(
                element(documentRef, "h3", { text: "Quantity" }),
                renderQuantityStepper(documentRef, {
                    value: session.selection.getQuantity(),
                    minimum: 1,
                    disabled: adding,
                    label: configuration.title,
                    onDecrease: () => { session.selection.decrease(); renderConfiguration(); },
                    onIncrease: () => { session.selection.increase(); renderConfiguration(); },
                }),
            );
            buildSet.append(quantityBlock);
            buildSet.append(element(documentRef, "p", {
                className: "cbs-composer__eyebrow",
                text: `Configure your ${session.selection.getQuantity()} item${session.selection.getQuantity() === 1 ? "" : "s"}`,
            }));
            buildSet.append(renderUnitList());
            content.append(buildSet);
        }

        refreshAddState();
    }

    async function open(product, source) {
        const sequence = ++loadSequence;
        activeProduct = product;
        launcher = source;
        configuration = null;
        session = null;
        loading = true;
        adding = false;
        dialog.setAttribute("aria-busy", "true");
        closeButton.disabled = false;
        heading.textContent = product.title;
        status.textContent = "Loading product options…";
        content.replaceChildren(element(documentRef, "p", { className: "cbs-composer__message", text: "Loading options…" }));
        total.textContent = "Total pieces: 0";
        addButton.textContent = "Add selected items";
        addButton.disabled = true;
        root.hidden = false;
        documentRef.body.classList.add("cbs-composer-is-open");
        dialog.focus({ preventScroll: true });

        try {
            const loaded = await optionsService.load(product);
            if (sequence !== loadSequence || activeProduct !== product) return;
            configuration = loaded;
            session = createComposerSubmission({ configuration, manager });
            status.textContent = configuration.purchasableVariants.length
                ? "Choose a quantity, then configure each item."
                : "This product is currently unavailable.";
            renderConfiguration();
            focusableElements(dialog)[0]?.focus({ preventScroll: true });
        } catch {
            if (sequence !== loadSequence) return;
            content.replaceChildren(element(documentRef, "p", {
                className: "cbs-composer__message",
                text: "Product options couldn’t be loaded. Please try again.",
            }));
            status.textContent = "Product options are unavailable.";
        } finally {
            if (sequence === loadSequence) {
                loading = false;
                dialog.setAttribute("aria-busy", "false");
                refreshAddState();
            }
        }
    }

    function close({ restoreFocus = true } = {}) {
        if (adding || root.hidden) return;
        loadSequence += 1;
        root.hidden = true;
        documentRef.body.classList.remove("cbs-composer-is-open");
        activeProduct = null;
        configuration = null;
        session = null;
        content.replaceChildren();
        if (restoreFocus) launcher?.focus?.({ preventScroll: true });
        launcher = null;
    }

    async function submit() {
        if (!session || adding || !session.selection.isComplete()) return;
        adding = true;
        status.textContent = "Adding your selections…";
        dialog.setAttribute("aria-busy", "true");
        renderConfiguration();
        try {
            await session.submit();
            const cbsCart = cartController();
            if (cbsCart?.refresh) await cbsCart.refresh();
            status.textContent = "Added to your cart.";
            adding = false;
            dialog.setAttribute("aria-busy", "false");
            const returnTarget = launcher;
            close({ restoreFocus: false });
            if (cbsCart?.open) await cbsCart.open({ currentTarget: returnTarget }, { refresh: false });
        } catch (error) {
            adding = false;
            dialog.setAttribute("aria-busy", "false");
            closeButton.disabled = false;
            status.textContent = customerErrorMessage(error);
            renderConfiguration();
        }
    }

    function handleKeydown(event) {
        if (event.key === "Escape") {
            event.preventDefault();
            close();
            return;
        }
        if (event.key !== "Tab") return;
        const focusable = focusableElements(dialog);
        if (!focusable.length) {
            event.preventDefault();
            dialog.focus();
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

    closeButton.addEventListener("click", () => close());
    backdrop.addEventListener("click", () => close());
    addButton.addEventListener("click", submit);
    dialog.addEventListener("keydown", handleKeydown);

    return Object.freeze({
        mount(node, product) {
            const button = element(documentRef, "button", {
                className: "cbs-composer-launcher",
                text: "Buy now",
                attributes: { type: "button", "aria-haspopup": "dialog", "aria-controls": "cbs-variant-composer" },
            });
            button.addEventListener("click", () => open(product, button));
            node.replaceChildren(button);
            node.dataset.shopifyMountState = "composer-qa";
        },
        open,
        close,
    });
}

export function initializeVariantComposerQa({
    mounts = document.querySelectorAll("[data-shopify-product-key]"),
    getProduct,
    locationRef = globalThis.location,
    controller = null,
    windowRef = globalThis.window,
} = {}) {
    if (!isLocalCommerceQaEnabled(locationRef) || typeof getProduct !== "function") return false;
    const activeController = controller ?? createVariantComposerController();
    Array.from(mounts).forEach(node => {
        const product = getProduct(node.dataset.shopifyProductKey);
        if (product) activeController.mount(node, product);
    });
    windowRef.CBSVariantComposerQA = activeController;
    return true;
}
