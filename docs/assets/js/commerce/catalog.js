import { SHOPIFY_CONFIG } from "./config.js";
import {
    PRODUCT_GROUPS,
    PRODUCT_REGISTRY,
    SIGNATURE_MATERIALS,
    getProductByKey,
    getProductPresentation,
} from "./products.js";
import { getCommerceDiagnostics, mountShopifyProduct } from "./shopify-buy.js";
import { initializeVariantComposerQa } from "./variant-composer.js";

let catalogInitialized = false;
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        "\"": "&quot;",
    })[character]);
}

function getCatalogPresentations(products) {
    const signatureProducts = SIGNATURE_MATERIALS
        .map(material => products.find(product => product.key === material.productKey))
        .filter(Boolean);
    const standardProducts = products.filter(product => (
        !SIGNATURE_MATERIALS.some(material => material.productKey === product.key)
    ));

    if (signatureProducts.length === SIGNATURE_MATERIALS.length) {
        const artworkPresentations = signatureProducts[0].previews.map((preview, previewIndex) => ({
            product: signatureProducts[0],
            preview,
            previewIndex,
            signatureProducts: signatureProducts.map(product => getProductPresentation(product, previewIndex)),
        }));

        return [
            ...artworkPresentations,
            ...standardProducts.map(product => ({ product, preview: product.image, previewIndex: 0 })),
        ];
    }

    const maximumPreviewCount = Math.max(
        1,
        ...products.map(product => product.previews?.length ?? 1),
    );

    return Array.from({ length: maximumPreviewCount }, (_, previewIndex) => (
        products.flatMap(product => {
            const previews = product.previews?.length ? product.previews : [product.image];
            const preview = previews[previewIndex];

            return preview ? [{ product, preview, previewIndex }] : [];
        })
    )).flat();
}

function getPresentationMountId(product, previewIndex) {
    return previewIndex === 0
        ? product.componentId
        : `${product.componentId}-preview-${previewIndex + 1}`;
}

function renderProductCard(presentation, position, total) {
    const { product, preview, previewIndex, signatureProducts = null } = presentation;
    const mountId = getPresentationMountId(product, previewIndex);
    const titleId = `${mountId}-title`;
    const cardTitle = signatureProducts ? preview.artwork : product.title;
    const commerceMarkup = signatureProducts
        ? signatureProducts.map((signatureProduct, materialIndex) => `
            <div
                class="cbs-commerce-mount${materialIndex === 0 ? "" : " cbs-commerce-mount--coordinated"}"
                id="${escapeHtml(getPresentationMountId(signatureProduct, previewIndex))}"
                data-shopify-product-key="${escapeHtml(signatureProduct.key)}"
                data-catalog-preview-index="${previewIndex}"
                data-signature-artwork="${escapeHtml(preview.artwork)}"
                data-signature-material="${escapeHtml(SIGNATURE_MATERIALS[materialIndex].label)}"
                aria-label="Buy ${escapeHtml(preview.artwork)} in ${escapeHtml(SIGNATURE_MATERIALS[materialIndex].label)}"
                ${materialIndex === 0 ? "" : "hidden"}
            ></div>
        `).join("")
        : `
            <div
                class="cbs-commerce-mount"
                id="${escapeHtml(mountId)}"
                data-shopify-product-key="${escapeHtml(product.key)}"
                data-catalog-preview-index="${previewIndex}"
                aria-label="Buy ${escapeHtml(product.title)}"
            ></div>
        `;

    return `
        <article
            class="cbs-product-card"
            aria-labelledby="${escapeHtml(titleId)}"
            aria-roledescription="slide"
            aria-label="${position} of ${total}"
        >
            <figure class="cbs-product-card__media">
                <img
                    src="${escapeHtml(preview.src)}"
                    alt="${escapeHtml(preview.alt)}"
                    width="${preview.width}"
                    height="${preview.height}"
                    loading="lazy"
                    decoding="async"
                />
            </figure>
            <div class="cbs-product-card__body">
                <h4 id="${escapeHtml(titleId)}">${escapeHtml(cardTitle)}</h4>
                <div class="cbs-product-card__commerce">
                    ${commerceMarkup}
                </div>
            </div>
        </article>
    `;
}

function renderCatalog() {
    const catalog = document.querySelector("[data-commerce-catalog]");

    if (!catalog || catalog.dataset.catalogRendered === "true") {
        return;
    }

    const tabs = PRODUCT_GROUPS.map((group, index) => {
        const products = PRODUCT_REGISTRY.filter(product => product.group === group.key);
        return `
            <button
                type="button"
                class="cbs-store-tab"
                id="store-tab-${group.key}"
                role="tab"
                aria-selected="${index === 0}"
                aria-controls="store-panel-${group.key}"
                tabindex="${index === 0 ? 0 : -1}"
                data-store-tab="${group.key}"
            >
                <span class="cbs-store-tab__label">${escapeHtml(group.title)}</span>
            </button>
        `;
    }).join("");

    const panels = PRODUCT_GROUPS.map((group, index) => {
        const products = PRODUCT_REGISTRY.filter(product => product.group === group.key);
        const presentations = getCatalogPresentations(products);
        const headingId = `store-group-${group.key}`;
        const panelId = `store-panel-${group.key}`;
        const panelTitle = group.panelTitle === null ? null : (group.panelTitle ?? group.title);

        return `
            <section
                class="cbs-store-group"
                id="${panelId}"
                role="tabpanel"
                aria-labelledby="store-tab-${group.key}"
                data-store-panel="${group.key}"
                ${index === 0 ? "" : "hidden"}
            >
                <div class="cbs-store-group__toolbar">
                    ${panelTitle
                        ? `<header class="cbs-store-group__header"><h3 id="${headingId}">${escapeHtml(panelTitle)}</h3></header>`
                        : `<div class="cbs-store-group__header" aria-hidden="true"></div>`}
                    <div class="cbs-store-pager" aria-label="${escapeHtml(group.title)} product controls">
                        <button type="button" class="cbs-store-pager__button" data-store-prev aria-label="Previous ${escapeHtml(group.title)} product">
                            <span aria-hidden="true">‹</span>
                        </button>
                        <span class="cbs-store-pager__status" data-store-status aria-live="polite">01 / ${String(presentations.length).padStart(2, "0")}</span>
                        <button type="button" class="cbs-store-pager__button" data-store-next aria-label="Next ${escapeHtml(group.title)} product">
                            <span aria-hidden="true">›</span>
                        </button>
                    </div>
                </div>
                <div
                    class="cbs-store-track"
                    data-store-track
                    data-store-product-count="${presentations.length}"
                    role="region"
                    aria-roledescription="carousel"
                    aria-label="${escapeHtml(group.title)} products"
                    tabindex="0"
                >
                    ${presentations.map((presentation, presentationIndex) => renderProductCard(presentation, presentationIndex + 1, presentations.length)).join("")}
                </div>
            </section>
        `;
    }).join("");

    catalog.innerHTML = `
        <div class="cbs-store-tabs" role="tablist" aria-label="Studio Store categories">
            ${tabs}
        </div>
        <div class="cbs-store-panels">
            ${panels}
        </div>
    `;

    catalog.dataset.catalogRendered = "true";
}

function getTrackMetrics(track) {
    const cards = Array.from(track.querySelectorAll(".cbs-product-card"));
    const firstCard = cards[0];
    const styles = window.getComputedStyle(track);
    const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0;
    const step = firstCard ? firstCard.getBoundingClientRect().width + gap : 1;
    const visibleCount = firstCard ? Math.max(1, Math.round((track.clientWidth + gap) / step)) : 1;

    return { cards, step, visibleCount };
}

function updatePager(panel) {
    const track = panel.querySelector("[data-store-track]");
    const previous = panel.querySelector("[data-store-prev]");
    const next = panel.querySelector("[data-store-next]");
    const status = panel.querySelector("[data-store-status]");
    const { cards, step, visibleCount } = getTrackMetrics(track);
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const start = Math.min(Math.max(0, Math.round(track.scrollLeft / step)), Math.max(0, cards.length - visibleCount));
    const end = Math.min(cards.length, start + visibleCount);
    const startLabel = String(start + 1).padStart(2, "0");
    const endLabel = String(end).padStart(2, "0");
    const totalLabel = String(cards.length).padStart(2, "0");

    previous.disabled = track.scrollLeft <= 2;
    next.disabled = track.scrollLeft >= maxScroll - 2;
    status.textContent = visibleCount > 1 && end > start + 1
        ? `${startLabel}–${endLabel} / ${totalLabel}`
        : `${startLabel} / ${totalLabel}`;
}

function moveTrack(panel, direction) {
    const track = panel.querySelector("[data-store-track]");
    const { cards, step } = getTrackMetrics(track);
    const current = Math.round(track.scrollLeft / step);
    const target = Math.min(Math.max(0, current + direction), cards.length - 1);

    cards[target]?.scrollIntoView({
        behavior: reducedMotionQuery.matches ? "auto" : "smooth",
        block: "nearest",
        inline: "start",
    });
}

function initProductPaging() {
    document.querySelectorAll("[data-store-panel]").forEach(panel => {
        const track = panel.querySelector("[data-store-track]");
        let updateFrame = 0;
        const scheduleUpdate = () => {
            if (updateFrame) {
                return;
            }
            updateFrame = window.requestAnimationFrame(() => {
                updateFrame = 0;
                updatePager(panel);
            });
        };

        panel.querySelector("[data-store-prev]").addEventListener("click", () => moveTrack(panel, -1));
        panel.querySelector("[data-store-next]").addEventListener("click", () => moveTrack(panel, 1));
        track.addEventListener("scroll", scheduleUpdate, { passive: true });
        track.addEventListener("keydown", event => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                return;
            }
            event.preventDefault();
            moveTrack(panel, event.key === "ArrowLeft" ? -1 : 1);
        });
        window.addEventListener("resize", scheduleUpdate, { passive: true });
        scheduleUpdate();
    });
}

function initCategorySwitcher() {
    const tabs = Array.from(document.querySelectorAll("[data-store-tab]"));
    const panels = Array.from(document.querySelectorAll("[data-store-panel]"));

    const activate = (index, moveFocus = false) => {
        tabs.forEach((tab, tabIndex) => {
            const selected = tabIndex === index;
            tab.setAttribute("aria-selected", String(selected));
            tab.tabIndex = selected ? 0 : -1;
        });
        panels.forEach((panel, panelIndex) => {
            panel.hidden = panelIndex !== index;
        });
        if (moveFocus) {
            tabs[index].focus();
        }
        window.requestAnimationFrame(() => updatePager(panels[index]));
    };

    tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => activate(index));
        tab.addEventListener("keydown", event => {
            let targetIndex = null;
            if (event.key === "ArrowRight") targetIndex = (index + 1) % tabs.length;
            if (event.key === "ArrowLeft") targetIndex = (index - 1 + tabs.length) % tabs.length;
            if (event.key === "Home") targetIndex = 0;
            if (event.key === "End") targetIndex = tabs.length - 1;
            if (targetIndex === null) {
                return;
            }
            event.preventDefault();
            activate(targetIndex, true);
        });
    });
}

function linkProductReferences() {
    document.querySelectorAll("[data-shopify-link-key]").forEach(link => {
        const product = getProductByKey(link.dataset.shopifyLinkKey);

        if (product) {
            link.setAttribute("href", `#${product.componentId}`);
        }
    });
}

function reportMountError(node, message) {
    node.dataset.shopifyMountState = "error";
    node.textContent = "Shopping is temporarily unavailable.";
    console.error(message);
}

function validateMount(node) {
    const key = node.dataset.shopifyProductKey;
    const product = getProductByKey(key);

    if (!product) {
        reportMountError(node, `Unknown Shopify product key: ${key}`);
        return null;
    }

    const previewIndex = Number.parseInt(node.dataset.catalogPreviewIndex ?? "0", 10);
    const expectedMountId = getPresentationMountId(product, previewIndex);

    if (!Number.isInteger(previewIndex) || previewIndex < 0 || node.id !== expectedMountId) {
        reportMountError(node, `Shopify component ID mismatch for ${key}.`);
        return null;
    }

    return getProductPresentation(product, previewIndex);
}

export function initCommerceCatalog() {
    if (catalogInitialized) {
        return;
    }

    catalogInitialized = true;
    renderCatalog();
    initCategorySwitcher();
    initProductPaging();
    linkProductReferences();
    const mounts = Array.from(document.querySelectorAll(SHOPIFY_CONFIG.mountSelector));

    if (initializeVariantComposerQa({ mounts, getProduct: (_key, node) => validateMount(node) })) {
        return;
    }

    const mount = node => {
        const product = validateMount(node);
        if (product) {
            mountShopifyProduct(product, node);
        }
    };

    const mountCardProducts = node => {
        const card = node.closest(".cbs-product-card");
        const coordinatedMounts = card?.querySelectorAll("[data-signature-artwork][data-shopify-product-key]");

        if (coordinatedMounts?.length) {
            coordinatedMounts.forEach(coordinatedNode => mount(coordinatedNode));
            return;
        }

        mount(node);
    };

    if (!("IntersectionObserver" in window)) {
        mounts.forEach(mountCardProducts);
        return;
    }

    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) {
                return;
            }

            const cardMounts = entry.target.closest(".cbs-product-card")
                ?.querySelectorAll("[data-shopify-product-key]") ?? [entry.target];
            cardMounts.forEach(cardMount => observer.unobserve(cardMount));
            mountCardProducts(entry.target);
        });
    }, SHOPIFY_CONFIG.observer);

    mounts.forEach(node => observer.observe(node));
}

window.CBSCommerce = Object.freeze({
    getDiagnostics: () => Object.freeze({
        ...getCommerceDiagnostics(),
        registryCount: PRODUCT_REGISTRY.length,
        mountCount: document.querySelectorAll(SHOPIFY_CONFIG.mountSelector).length,
        activeGroup: document.querySelector("[data-store-tab][aria-selected='true']")?.dataset.storeTab ?? null,
    }),
    productRegistryCount: PRODUCT_REGISTRY.length,
});

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCommerceCatalog, { once: true });
} else {
    initCommerceCatalog();
}
