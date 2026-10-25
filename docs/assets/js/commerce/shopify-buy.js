import { SHOPIFY_CONFIG } from "./config.js";

let sdkPromise = null;
let client = null;
let uiPromise = null;
let uiInstance = null;
let modalReturnPosition = null;
let stopModalViewportTracking = null;
let activeSignatureCoordinator = null;
let materialSwitchInProgress = false;
const mountPromises = new WeakMap();
const signatureCoordinators = new Map();
const SIGNATURE_MATERIALS = Object.freeze([
    Object.freeze({ label: "Signature Frame", productId: "8296598536261" }),
    Object.freeze({ label: "Signature Acrylic", productId: "8296938537029" }),
]);
const CART_LINE_QUANTITY_TEMPLATE = `
    <div class="{{data.classes.lineItem.controls}}" data-element="lineItem.controls">
        <div class="{{data.classes.lineItem.quantity}}" data-element="lineItem.quantity">
            <button class="{{data.classes.lineItem.quantityButton}} {{data.classes.lineItem.quantityDecrement}}" type="button" data-line-item-id="{{data.id}}" data-element="lineItem.quantityDecrement">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 7h8v2H4z"/></svg>
                <span class="visuallyhidden">{{data.text.quantityDecrementAccessibilityLabel}}</span>
            </button>
            <input class="{{data.classes.lineItem.quantityInput}}" type="number" min="0" aria-label="{{data.text.quantityInputAccessibilityLabel}}" data-line-item-id="{{data.id}}" value="{{data.quantity}}" data-element="lineItem.quantityInput">
            <button class="{{data.classes.lineItem.quantityButton}} {{data.classes.lineItem.quantityIncrement}}" type="button" data-line-item-id="{{data.id}}" data-element="lineItem.quantityIncrement">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M12 7H9V4H7v3H4v2h3v3h2V9h3z"/></svg>
                <span class="visuallyhidden">{{data.text.quantityIncrementAccessibilityLabel}}</span>
            </button>
        </div>
        <button class="{{data.classes.lineItem.remove}}" type="button" data-line-item-id="{{data.id}}" data-element="lineItem.remove" aria-label="Remove {{data.title}} from cart">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M5.5 2.5h5l.75 1.5H14v1.5H2V4h2.75l.75-1.5ZM4 6.5h8l-.55 7H4.55L4 6.5Zm2 1.25.3 4.25h1V7.75H6Zm2.7 0V12h1l.3-4.25H8.7Z"/>
            </svg>
            <span class="visuallyhidden">Remove {{data.title}} from cart</span>
        </button>
    </div>
`;

function removeCartLine(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const button = target?.closest?.("[data-element='lineItem.remove']")
        ?? event.target?.closest?.("[data-element='lineItem.remove']");
    const lineItem = button?.closest?.(".shopify-buy__cart-item");
    const quantityInput = lineItem?.querySelector?.("[data-element='lineItem.quantityInput']");

    if (!button || !quantityInput || button.disabled) {
        return;
    }

    button.disabled = true;
    quantityInput.value = "0";
    const frameWindow = quantityInput.ownerDocument.defaultView;
    quantityInput.dispatchEvent(new frameWindow.Event("blur", { bubbles: true }));
}

function syncModalViewport() {
    const viewport = window.visualViewport;
    const width = Math.max(1, Math.round(viewport?.width ?? window.innerWidth));
    const height = Math.max(1, Math.round(viewport?.height ?? window.innerHeight));
    const offsetLeft = Math.max(0, Math.round(viewport?.offsetLeft ?? 0));
    const offsetTop = Math.max(0, Math.round(viewport?.offsetTop ?? 0));
    const rootStyle = document.documentElement.style;

    rootStyle.setProperty("--cbs-shopify-modal-viewport-width", `${width}px`);
    rootStyle.setProperty("--cbs-shopify-modal-viewport-height", `${height}px`);
    rootStyle.setProperty("--cbs-shopify-modal-viewport-left", `${offsetLeft}px`);
    rootStyle.setProperty("--cbs-shopify-modal-viewport-top", `${offsetTop}px`);
}

function beginModalViewportTracking() {
    stopModalViewportTracking?.();
    syncModalViewport();

    const viewport = window.visualViewport;
    const resizeTarget = viewport ?? window;
    resizeTarget.addEventListener("resize", syncModalViewport, { passive: true });
    viewport?.addEventListener("scroll", syncModalViewport, { passive: true });

    stopModalViewportTracking = () => {
        resizeTarget.removeEventListener("resize", syncModalViewport);
        viewport?.removeEventListener("scroll", syncModalViewport);
        stopModalViewportTracking = null;
    };
}

function clearModalViewport() {
    stopModalViewportTracking?.();
    const rootStyle = document.documentElement.style;

    rootStyle.removeProperty("--cbs-shopify-modal-viewport-width");
    rootStyle.removeProperty("--cbs-shopify-modal-viewport-height");
    rootStyle.removeProperty("--cbs-shopify-modal-viewport-left");
    rootStyle.removeProperty("--cbs-shopify-modal-viewport-top");
}

function captureModalReturnPosition() {
    if (!modalReturnPosition) {
        modalReturnPosition = Object.freeze({
            left: window.scrollX,
            top: window.scrollY,
        });
    }
    beginModalViewportTracking();
}

function scrollToSavedPosition(position) {
    if (!position) {
        return;
    }

    const restore = () => window.scrollTo({
        left: position.left,
        top: position.top,
        behavior: "auto",
    });

    restore();
    window.requestAnimationFrame(restore);
}

function formatModalTypography(documentRef) {
    documentRef.querySelectorAll(
        ".shopify-buy__product-description h1, .shopify-buy__product-description h2, .shopify-buy__product-description h3, .shopify-buy__product-description h4, .shopify-buy__product-description h5, .shopify-buy__product-description h6",
    ).forEach(titleNode => {
        titleNode.style.fontWeight = "400";
    });

    documentRef.querySelectorAll("[data-element='product.price']").forEach(priceNode => {
        if (priceNode.querySelector(".cbs-modal-price__decimals")) {
            return;
        }

        const priceText = priceNode.textContent.trim();
        const priceParts = priceText.match(/^(.*?)([.,]\d{2})(\s*[A-Z]{3})?$/);

        if (!priceParts) {
            return;
        }

        priceNode.style.display = "inline-block";
        priceNode.style.height = "16.8px";
        priceNode.style.lineHeight = "16.8px";

        const decimals = documentRef.createElement("span");
        decimals.className = "cbs-modal-price__decimals";
        decimals.textContent = priceParts[2];
        decimals.style.fontSize = "0.64em";
        decimals.style.fontWeight = "400";
        decimals.style.letterSpacing = "0";
        decimals.style.position = "relative";
        decimals.style.top = "-0.32em";

        priceNode.replaceChildren(
            documentRef.createTextNode(priceParts[1]),
            decimals,
            documentRef.createTextNode(priceParts[3] ?? ""),
        );
    });
}

function enhanceModalTypography(attempt = 0) {
    const modalFrame = document.querySelector(".shopify-buy-frame--modal iframe");
    const modalDocument = modalFrame?.contentDocument;

    if (!modalDocument?.body) {
        if (attempt < 12) {
            window.requestAnimationFrame(() => enhanceModalTypography(attempt + 1));
        }
        return;
    }

    formatModalTypography(modalDocument);

    if (modalDocument.documentElement.dataset.cbsTypographyObserver === "true") {
        return;
    }

    modalDocument.documentElement.dataset.cbsTypographyObserver = "true";
    const observer = new modalDocument.defaultView.MutationObserver(() => {
        formatModalTypography(modalDocument);
        renderSignatureMaterialSelector();
    });
    observer.observe(modalDocument.body, {
        childList: true,
        characterData: true,
        subtree: true,
    });
}

function maintainModalReturnPosition() {
    syncModalViewport();
    scrollToSavedPosition(modalReturnPosition);
    window.requestAnimationFrame(() => {
        enhanceModalTypography();
        renderSignatureMaterialSelector();
    });
}

function restoreModalReturnPosition() {
    if (materialSwitchInProgress) {
        return;
    }

    const returnPosition = modalReturnPosition;
    modalReturnPosition = null;

    window.requestAnimationFrame(() => {
        clearModalViewport();
        scrollToSavedPosition(returnPosition);
    });
}

function isSdkReady() {
    return Boolean(window.ShopifyBuy?.buildClient && window.ShopifyBuy?.UI);
}

function loadShopifyBuySdk() {
    if (isSdkReady()) {
        return Promise.resolve(window.ShopifyBuy);
    }

    if (sdkPromise) {
        return sdkPromise;
    }

    sdkPromise = new Promise((resolve, reject) => {
        let script = document.getElementById(SHOPIFY_CONFIG.sdkScriptId);

        const handleLoad = () => {
            if (!isSdkReady()) {
                reject(new Error("Shopify Buy Button SDK loaded without its UI runtime."));
                return;
            }

            resolve(window.ShopifyBuy);
        };

        const handleError = () => reject(new Error("Unable to load the Shopify Buy Button SDK."));

        if (!script) {
            script = document.createElement("script");
            script.id = SHOPIFY_CONFIG.sdkScriptId;
            script.async = true;
            script.src = SHOPIFY_CONFIG.sdkUrl;
        }

        script.addEventListener("load", handleLoad, { once: true });
        script.addEventListener("error", handleError, { once: true });

        if (!script.isConnected) {
            document.head.appendChild(script);
        }

        if (isSdkReady()) {
            handleLoad();
        }
    });

    return sdkPromise;
}

export async function getShopifyUi() {
    if (!uiPromise) {
        uiPromise = loadShopifyBuySdk().then(ShopifyBuy => {
            if (!client) {
                client = ShopifyBuy.buildClient({
                    domain: SHOPIFY_CONFIG.domain,
                    storefrontAccessToken: SHOPIFY_CONFIG.storefrontAccessToken,
                });
            }

            return ShopifyBuy.UI.onReady(client);
        }).then(ui => {
            uiInstance = ui;
            return ui;
        });
    }

    return uiPromise;
}

function getSignaturePresentation(product) {
    const presentation = product.group === "signature-art"
        ? product.presentation
        : null;

    return presentation?.variantId && presentation?.selectedOptions?.length
        ? presentation
        : null;
}

function getVariantOptionValue(variant, optionName) {
    const options = variant?.selectedOptions ?? variant?.optionValues ?? [];
    return options.find(option => option.name === optionName)?.value ?? null;
}

function optionValueIdentity(value) {
    return typeof value === "string" ? value : value?.value ?? value?.name ?? null;
}

function componentProductId(component) {
    return String(component?.model?.id ?? "").split("/").pop();
}

function componentVariantId(component) {
    return String(component?.selectedVariant?.id ?? "").split("/").pop();
}

function signatureCoordinatorFor(product, presentation) {
    if (!presentation?.artwork) {
        return null;
    }

    let coordinator = signatureCoordinators.get(presentation.artwork);

    if (!coordinator) {
        coordinator = {
            artwork: presentation.artwork,
            activeMaterial: SIGNATURE_MATERIALS[0].label,
            components: new Map(),
        };
        signatureCoordinators.set(presentation.artwork, coordinator);
    }

    const material = SIGNATURE_MATERIALS.find(candidate => candidate.productId === product.productId);
    return material ? { coordinator, material } : null;
}

function registerSignatureComponent(component, product, presentation) {
    const registration = signatureCoordinatorFor(product, presentation);

    if (!registration) {
        return;
    }

    registration.coordinator.components.set(registration.material.label, component);
}

function activateModalContext(component, product, presentation) {
    const registration = signatureCoordinatorFor(product, presentation);
    activeSignatureCoordinator = registration?.coordinator ?? null;

    if (registration) {
        registration.coordinator.activeMaterial = registration.material.label;
        registration.coordinator.activeComponent = component;
    }

    captureModalReturnPosition();
}

function applyComponentOptions(component, options) {
    ["Orientation", "Size"].forEach(optionName => {
        if (options[optionName]) {
            component.updateVariant(optionName, options[optionName]);
        }
    });

    return component.selectedVariant
        && component.selectedOptions?.Artwork === options.Artwork
        && component.selectedOptions?.Orientation === options.Orientation
        && component.selectedOptions?.Size === options.Size;
}

async function switchSignatureMaterial(materialLabel, select) {
    const coordinator = activeSignatureCoordinator;
    const currentComponent = coordinator?.activeComponent;
    const currentModalProduct = currentComponent?.modal?.product;
    const targetComponent = coordinator?.components.get(materialLabel);

    if (
        !coordinator
        || !currentModalProduct
        || !targetComponent
        || materialLabel === coordinator.activeMaterial
    ) {
        return;
    }

    const selectedOptions = Object.freeze({
        Artwork: coordinator.artwork,
        Orientation: currentModalProduct.selectedOptions?.Orientation,
        Size: currentModalProduct.selectedOptions?.Size,
    });
    const expectedProduct = SIGNATURE_MATERIALS.find(material => material.label === materialLabel);

    select.disabled = true;
    select.setAttribute("aria-busy", "true");

    if (
        !applyComponentOptions(targetComponent, selectedOptions)
        || componentProductId(targetComponent) !== expectedProduct?.productId
        || !componentVariantId(targetComponent)
    ) {
        select.value = coordinator.activeMaterial;
        select.disabled = false;
        select.removeAttribute("aria-busy");
        console.error(`CicloBeef material variant could not be resolved for ${coordinator.artwork}.`);
        return;
    }

    materialSwitchInProgress = true;
    await Promise.resolve(currentComponent.modal.close());
    await Promise.resolve(targetComponent.openModal());
    const targetModalProduct = targetComponent.modal?.product;

    if (
        !applyComponentOptions(targetModalProduct, selectedOptions)
        || componentProductId(targetModalProduct) !== expectedProduct.productId
        || !componentVariantId(targetModalProduct)
    ) {
        console.error(`CicloBeef material modal could not be resolved for ${coordinator.artwork}.`);
        await Promise.resolve(targetComponent.modal?.close());
        await Promise.resolve(currentComponent.openModal());
        applyComponentOptions(currentComponent.modal?.product, selectedOptions);
    }

    materialSwitchInProgress = false;
}

function renderSignatureMaterialSelector() {
    const coordinator = activeSignatureCoordinator;
    const modalFrame = document.querySelector(".shopify-buy-frame--modal iframe");
    const modalDocument = modalFrame?.contentDocument;
    const orientation = modalDocument?.querySelector('select[name="Orientation"]');

    if (!coordinator || !orientation || coordinator.components.size !== SIGNATURE_MATERIALS.length) {
        return;
    }

    const existing = modalDocument.querySelector('select[name="Material"]');

    if (existing) {
        existing.value = coordinator.activeMaterial;
        return;
    }

    const field = modalDocument.createElement("div");
    field.className = "shopify-buy__option-select cbs-signature-material";
    const label = modalDocument.createElement("label");
    label.className = "shopify-buy__option-select__label";
    label.textContent = "Material";
    const wrapper = modalDocument.createElement("div");
    wrapper.className = "shopify-buy__option-select-wrapper";
    const select = modalDocument.createElement("select");
    const selectId = `cbs-signature-material-${coordinator.artwork.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    select.id = selectId;
    select.name = "Material";
    select.className = "shopify-buy__option-select__select";
    label.htmlFor = selectId;

    SIGNATURE_MATERIALS.forEach(material => {
        const option = modalDocument.createElement("option");
        option.value = material.label;
        option.textContent = material.label;
        select.append(option);
    });

    select.value = coordinator.activeMaterial;
    select.addEventListener("change", () => {
        switchSignatureMaterial(select.value, select).catch(error => {
            materialSwitchInProgress = false;
            console.error("CicloBeef material switch failed.", error);
        });
    });
    wrapper.append(select);
    field.append(label, wrapper);
    orientation.closest(".shopify-buy__option-select")?.before(field);
}

export function scopeSignaturePresentation(component, presentation) {
    const selectedOptions = presentation?.selectedOptions ?? [];

    if (
        !selectedOptions.length
        || !Array.isArray(component?.model?.images)
        || !Array.isArray(component?.model?.variants)
    ) {
        return false;
    }

    const scopedVariants = component.model.variants.filter(variant => (
        selectedOptions.every(expected => getVariantOptionValue(variant, expected.name) === expected.value)
    ));
    const selectedVariantId = String(presentation.variantId);

    if (
        !scopedVariants.length
        || !scopedVariants.some(variant => String(variant.id).split("/").pop() === selectedVariantId)
    ) {
        console.error(`CicloBeef presentation variants could not be resolved for ${presentation.artwork}.`);
        return false;
    }

    const artworkImageOrientations = new Map();
    scopedVariants.forEach(variant => {
        const imageId = variant.image?.id;
        const orientation = getVariantOptionValue(variant, "Orientation");

        if (imageId && (orientation === "Horizontal" || orientation === "Vertical")) {
            artworkImageOrientations.set(imageId, orientation);
        }
    });

    const retainedOrientations = new Set();
    const artworkImages = component.model.images.filter(image => {
        const orientation = artworkImageOrientations.get(image.id);

        if (!orientation || retainedOrientations.has(orientation)) {
            return false;
        }

        retainedOrientations.add(orientation);
        return true;
    });

    if (
        artworkImages.length !== 2
        || !retainedOrientations.has("Horizontal")
        || !retainedOrientations.has("Vertical")
    ) {
        console.error(`CicloBeef artwork orientations could not be resolved for ${presentation.artwork}.`);
        return false;
    }

    const scopedOptionValues = selectedOptions.map(expected => {
        const option = component.model.options?.find(candidate => candidate.name === expected.name);
        const values = Array.isArray(option?.values)
            ? option.values.filter(value => optionValueIdentity(value) === expected.value)
            : [];

        return { option, values };
    });

    if (scopedOptionValues.some(({ option, values }) => !option || values.length !== 1)) {
        console.error(`CicloBeef presentation options could not be resolved for ${presentation.artwork}.`);
        return false;
    }

    component.model.variants.splice(0, component.model.variants.length, ...scopedVariants);
    component.model.images.splice(0, component.model.images.length, ...artworkImages);
    scopedOptionValues.forEach(({ option, values }) => {
        option.values.splice(0, option.values.length, ...values);
    });
    return true;
}

function componentOptions(product, signaturePresentation = null) {
    const supportsDesktopHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const usesDesktopNavigation = supportsDesktopHover && window.matchMedia("(min-width: 1025px)").matches;
    const usesCompactViewport = window.matchMedia("(max-width: 499px)").matches;
    const usesTabletViewport = window.matchMedia(
        "(min-width: 641px) and (max-width: 1180px), (min-width: 641px) and (max-width: 1366px) and (hover: none) and (pointer: coarse)",
    ).matches;
    const usesContainedModal = usesTabletViewport
        || (supportsDesktopHover && window.matchMedia("(min-width: 1181px)").matches);
    const productButtonHoverStyle = supportsDesktopHover
        ? { "background-color": "#FFC300", "color": "#1A1A1A" }
        : { "background-color": "#363636", "color": "#FFFFFF" };
    const productButtonLayoutStyle = usesCompactViewport
        ? { "display": "block", "margin-left": "auto", "margin-right": "auto" }
        : usesTabletViewport
            ? {
                "display": "block",
                "min-width": "132px",
                "min-height": "42px",
                "margin-left": "auto",
                "margin-right": "auto",
                "padding": "11px 22px",
            }
            : {};
    const modalImageStyle = usesCompactViewport
        ? {
            "display": "block",
            "width": "76%",
            "height": "auto",
            "max-width": "76%",
            "max-height": "240px",
            "margin": "0 auto",
            "object-fit": "contain",
        }
        : { "max-height": "320px", "object-fit": "contain" };
    const modalCarouselStyle = usesCompactViewport
        ? { "min-height": "64px", "margin-top": "10px" }
        : {};
    const modalCarouselControlStyle = usesCompactViewport
        ? {
            "top": "50%",
            "width": "44px",
            "height": "44px",
            "padding": "0",
            "border": "0",
            "border-radius": "0",
            "background-color": "transparent",
            "box-shadow": "none",
            "color": "#363636",
            "font-size": "0",
            "line-height": "0",
            "opacity": "1",
        }
        : {};
    const modalCloseStyle = {
        "display": "flex",
        "align-items": "center",
        "justify-content": "center",
        "box-sizing": "border-box",
        "border": "0",
        "border-radius": "50%",
        "outline": "none",
        "background-color": "#4A4A4A",
        "background-image": "linear-gradient(45deg, transparent 43%, #FFFFFF 43%, #FFFFFF 57%, transparent 57%), linear-gradient(-45deg, transparent 43%, #FFFFFF 43%, #FFFFFF 57%, transparent 57%)",
        "background-position": "center",
        "background-repeat": "no-repeat",
        "background-size": "10px 10px",
        "box-shadow": "none",
        "color": "#FFFFFF",
        "font-size": "0",
        "font-weight": "400",
        "line-height": "0",
        "text-align": "center",
        ":hover": {
            "background-color": "#565656",
        },
        ":focus": {
            "outline": "none",
            "background-color": "#5A5A5A",
        },
    };

    return {
        product: {
            buttonDestination: "modal",
            events: {
                afterInit: component => {
                    if (scopeSignaturePresentation(component, signaturePresentation)) {
                        registerSignatureComponent(component, product, signaturePresentation);
                    }
                },
                openModal: component => activateModalContext(component, product, signaturePresentation),
            },
            contents: {
                img: false,
                title: false,
                price: false,
                options: false,
                quantity: false,
                button: true,
            },
            styles: {
                product: {
                    "margin": "0",
                    "max-width": "100%",
                    "text-align": "center",
                },
                button: {
                    "background-color": "#363636",
                    "border-radius": "999px",
                    "font-family": "Inter, sans-serif",
                    "font-size": "12px",
                    "font-weight": "700",
                    "letter-spacing": "0.02em",
                    "min-height": "38px",
                    "padding": "10px 18px",
                    ...productButtonLayoutStyle,
                    ":hover": productButtonHoverStyle,
                    ":focus": { "background-color": "#4a4a4a" },
                },
            },
            text: { button: "Buy now" },
        },
        modalProduct: {
            contents: {
                img: false,
                imgWithCarousel: true,
                title: true,
                price: true,
                description: true,
                options: true,
                quantity: false,
                button: false,
                buttonWithQuantity: true,
            },
            text: { button: "Add to cart" },
            styles: {
                product: {
                    "max-width": "100%",
                    "margin": "0",
                    "padding": usesCompactViewport
                        ? "calc(52px + env(safe-area-inset-top)) 14px calc(18px + env(safe-area-inset-bottom))"
                        : "calc(60px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom))",
                    "@media (min-width: 500px)": {
                        "padding": "clamp(36px, 4.5vw, 42px) clamp(18px, 3.5vw, 30px) clamp(18px, 3.5vw, 30px)",
                    },
                },
                img: modalImageStyle,
                imgWrapper: usesContainedModal ? { "height": "auto" } : {},
                carousel: modalCarouselStyle,
                carouselPrevious: {
                    ...modalCarouselControlStyle,
                    ...(usesCompactViewport ? {
                        "left": "4px",
                        "transform": "translateY(-50%) rotate(180deg) scale(1.12)",
                    } : {}),
                },
                carouselNext: {
                    ...modalCarouselControlStyle,
                    ...(usesCompactViewport ? {
                        "right": "4px",
                        "transform": "translateY(-50%) scale(1.12)",
                    } : {}),
                },
                title: {
                    "font-family": "Playfair Display, serif",
                    "font-size": usesCompactViewport ? "22px" : "26px",
                    "font-weight": "400",
                    "line-height": "1.2",
                    ...(usesContainedModal ? { "color": "#242424" } : {}),
                },
                compareAt: {
                    "display": "none",
                },
                price: {
                    "color": "#242424",
                    "font-family": "Inter, sans-serif",
                    "font-size": usesCompactViewport ? "22px" : "26px",
                    "font-variant-numeric": "tabular-nums",
                    "font-weight": "600",
                    "letter-spacing": "-0.02em",
                    "line-height": "16.8px",
                },
                description: {
                    "max-height": "7.5em",
                    "padding-right": "6px",
                    "overflow-y": "auto",
                    "font-size": "13px",
                    "line-height": "1.5",
                    ...(usesContainedModal ? { "color": "#363636" } : {}),
                },
                button: {
                    ...(usesDesktopNavigation ? {
                        "background-color": "#363636",
                        "color": "#FFFFFF",
                        "font-size": "12px",
                        "letter-spacing": "0.02em",
                        "min-height": "38px",
                        "padding": "10px 18px",
                    } : {
                        "background-color": "#1a1a1a",
                    }),
                    "border-radius": "999px",
                    "font-family": "Inter, sans-serif",
                    "font-weight": "700",
                    ":hover": usesDesktopNavigation
                        ? productButtonHoverStyle
                        : { "background-color": "#8a6500" },
                    ":focus": usesDesktopNavigation
                        ? { "background-color": "#4a4a4a" }
                        : { "background-color": "#8a6500" },
                },
            },
        },
        modal: {
            events: {
                afterRender: maintainModalReturnPosition,
                closeModal: restoreModalReturnPosition,
            },
            styles: {
                overlay: {
                    "display": "block",
                    "padding": "0",
                    "overflow-y": "auto",
                    "overscroll-behavior": "contain",
                    "-webkit-overflow-scrolling": "touch",
                    "background-color": "rgba(20, 20, 20, 0.72)",
                    "@media (min-width: 500px)": {
                        "display": "flex",
                        "align-items": "center",
                        "justify-content": "center",
                        "padding": "clamp(24px, 5vh, 48px) 16px",
                    },
                    ...(usesContainedModal ? {
                        "display": "flex",
                        "align-items": "center",
                        "justify-content": "center",
                        "padding": "24px 16px",
                        "background-color": "rgba(20, 20, 20, 0.38)",
                    } : {}),
                },
                modal: {
                    "width": "100%",
                    "max-width": "100%",
                    "height": "100%",
                    "min-height": "100%",
                    "max-height": "100%",
                    "position": "fixed",
                    "top": "0",
                    "bottom": "0",
                    "left": "0",
                    "right": "0",
                    "margin": "0",
                    "overflow-y": "auto",
                    "overscroll-behavior": "contain",
                    "border": "0",
                    "border-radius": "0",
                    "background-color": "#fffdf7",
                    "box-shadow": "0 26px 70px rgba(0, 0, 0, 0.28)",
                    "@media (min-width: 500px)": {
                        "width": "calc(100% - 32px)",
                        "max-width": "820px",
                        "height": "auto",
                        "min-height": "auto",
                        "max-height": "calc(100% - 48px)",
                        "position": "relative",
                        "top": "auto",
                        "bottom": "auto",
                        "left": "auto",
                        "right": "auto",
                        "margin": "auto",
                        "border": "1px solid rgba(54, 54, 54, 0.18)",
                        "border-radius": "12px",
                    },
                    // Buy Button emits base styles after media rules. Override the
                    // fullscreen base for the shared tablet and desktop panel.
                    ...(usesContainedModal ? {
                        "width": "calc(100% - 32px)",
                        "max-width": "820px",
                        "height": "auto",
                        "min-height": "0",
                        "max-height": "calc(100dvh - 48px)",
                        "position": "relative",
                        "top": "auto",
                        "bottom": "auto",
                        "left": "auto",
                        "right": "auto",
                        "margin": "auto",
                        "border": "1px solid rgba(255, 255, 255, 0.65)",
                        "border-radius": "12px",
                        "background-color": "rgba(255, 253, 247, 0.90)",
                        "color": "#363636",
                        "backdrop-filter": "blur(12px)",
                        "-webkit-backdrop-filter": "blur(12px)",
                    } : {}),
                },
                close: {
                    "position": "fixed",
                    "top": "calc(8px + env(safe-area-inset-top))",
                    "right": "calc(8px + env(safe-area-inset-right))",
                    "width": "36px",
                    "height": "36px",
                    "font-size": "36px",
                    "line-height": "40px",
                    "padding": "0",
                    "color": "#363636",
                    ...modalCloseStyle,
                    "@media (min-width: 500px)": {
                        "position": "absolute",
                        "top": "8px",
                        "right": "8px",
                    },
                    ...(usesContainedModal ? {
                        "position": "absolute",
                        "top": "8px",
                        "right": "8px",
                    } : {}),
                },
            },
        },
        cart: {
            popup: false,
            DOMEvents: {
                "click .cbs-buy-cart__remove": removeCartLine,
            },
            text: {
                total: "Subtotal",
                button: "Checkout",
            },
            styles: {
                button: {
                    "background-color": "#1a1a1a",
                    "border-radius": "999px",
                    "font-family": "Inter, sans-serif",
                    "font-weight": "700",
                    ":hover": { "background-color": "#8a6500" },
                    ":focus": { "background-color": "#8a6500" },
                },
            },
        },
        lineItem: {
            templates: {
                quantity: CART_LINE_QUANTITY_TEMPLATE,
            },
            classes: {
                controls: "cbs-buy-cart__line-controls",
                remove: "cbs-buy-cart__remove",
            },
            styles: {
                controls: {
                    "display": "flex",
                    "align-items": "center",
                    "gap": "8px",
                    "min-height": "32px",
                    "margin-left": "80px",
                },
                quantity: {
                    "flex": "0 0 auto",
                    "height": "30px",
                    "margin-left": "0",
                    "margin-right": "0",
                },
                remove: {
                    "display": "inline-flex",
                    "align-items": "center",
                    "justify-content": "center",
                    "flex": "0 0 32px",
                    "width": "32px",
                    "height": "32px",
                    "margin": "0",
                    "padding": "0",
                    "vertical-align": "middle",
                    "border": "0",
                    "border-radius": "50%",
                    "background-color": "transparent",
                    "color": "#4c4c4c",
                    "cursor": "pointer",
                    ":hover": {
                        "background-color": "rgba(54, 54, 54, 0.08)",
                        "color": "#1a1a1a",
                    },
                    ":focus": {
                        "outline": "2px solid #FFC300",
                        "outline-offset": "2px",
                    },
                    ":disabled": {
                        "opacity": "0.45",
                        "cursor": "wait",
                    },
                },
            },
        },
        toggle: {
            styles: {
                toggle: {
                    ...(usesDesktopNavigation ? {
                        "display": "inline-flex",
                        "flex-direction": "column",
                        "align-items": "center",
                        "justify-content": "center",
                        "padding": "4px 6px",
                        "border-radius": "0",
                        "background-color": "transparent",
                        "box-shadow": "none",
                        "color": "#FFFFFF",
                    } : {
                        "background-color": "#1a1a1a",
                    }),
                    ":hover": usesDesktopNavigation
                        ? { "background-color": "transparent", "color": "#FFC300" }
                        : { "background-color": "#8a6500" },
                    ":focus": usesDesktopNavigation
                        ? { "background-color": "transparent", "color": "#FFC300" }
                        : { "background-color": "#8a6500" },
                },
                count: usesDesktopNavigation ? {
                    "margin-right": "0",
                    "margin-bottom": "1px",
                    "font-size": "12px",
                    "font-weight": "600",
                    "line-height": "1",
                } : {},
            },
        },
    };
}

export function mountShopifyProduct(product, node) {
    if (mountPromises.has(node)) {
        return mountPromises.get(node);
    }

    const mountPromise = (async () => {
        node.dataset.shopifyMountState = "loading";

        try {
            const ui = await getShopifyUi();
            const signaturePresentation = getSignaturePresentation(product);
            const result = ui.createComponent("product", {
                id: product.productId,
                ...(signaturePresentation ? { variantId: signaturePresentation.variantId } : {}),
                node,
                options: componentOptions(product, signaturePresentation),
            });

            await Promise.resolve(result);
            node.dataset.shopifyMountState = "mounted";
        } catch (error) {
            node.dataset.shopifyMountState = "error";
            node.textContent = "Shopping is temporarily unavailable.";
            console.error("CicloBeef Shopify product mount failed.", error);
        }
    })();

    mountPromises.set(node, mountPromise);
    return mountPromise;
}

export function getCommerceDiagnostics() {
    return Object.freeze({
        sdkScriptCount: document.querySelectorAll(`script[src="${SHOPIFY_CONFIG.sdkUrl}"]`).length,
        clientCount: client ? 1 : 0,
        uiCount: uiInstance ? 1 : 0,
        cartRuntimeCount: uiInstance?.components?.cart?.length ?? 0,
        productComponentCount: uiInstance?.components?.product?.length ?? 0,
        signatureCoordinatorCount: signatureCoordinators.size,
        signatureCoordinators: [...signatureCoordinators.values()].map(coordinator => Object.freeze({
            artwork: coordinator.artwork,
            activeMaterial: coordinator.activeMaterial,
            componentCount: coordinator.components.size,
            productId: componentProductId(coordinator.activeComponent),
            variantId: componentVariantId(coordinator.activeComponent?.modal?.product ?? coordinator.activeComponent),
            selectedOptions: Object.freeze({
                ...(coordinator.activeComponent?.modal?.product?.selectedOptions
                    ?? coordinator.activeComponent?.selectedOptions
                    ?? {}),
            }),
        })),
    });
}
