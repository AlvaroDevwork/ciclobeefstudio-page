const { expect, test } = require("@playwright/test");

async function checkProductPreview({ page }, testInfo) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("#products").scrollIntoViewIfNeeded();
    const buyNow = page.frameLocator(".shopify-buy-frame--product iframe").first()
        .getByRole("button", { name: /buy now/i });
    await expect(buyNow).toBeVisible({ timeout: 40_000 });
    if (testInfo.project.name === "tablet-ipad-chromium") {
        const buttonGeometry = await buyNow.evaluate(node => {
            const rect = node.getBoundingClientRect();
            return {
                width: rect.width,
                height: rect.height,
                fontSize: Number.parseFloat(getComputedStyle(node).fontSize),
            };
        });
        expect(buttonGeometry.width).toBeGreaterThanOrEqual(160);
        expect(buttonGeometry.height).toBeGreaterThanOrEqual(48);
        expect(buttonGeometry.fontSize).toBeGreaterThanOrEqual(14);
    }
    await buyNow.click();
    const frame = page.frameLocator(".shopify-buy-frame--modal iframe");
    const panel = frame.locator(".shopify-buy__modal");
    const add = frame.getByRole("button", { name: /add to cart/i });
    await expect(panel).toBeVisible();
    await expect(add).toBeVisible();
    const diagnostic = await panel.evaluate(node => {
        const style = getComputedStyle(node);
        return {
            viewport: { width: innerWidth, height: innerHeight },
            panel: node.getBoundingClientRect().toJSON(),
            background: style.backgroundColor,
            height: style.height,
            minHeight: style.minHeight,
            maxHeight: style.maxHeight,
            position: style.position,
            children: [...node.querySelectorAll(".shopify-buy__modal-product-wrapper, .shopify-buy__product, .shopify-buy__layout-vertical, .shopify-buy__product-img-wrapper, .shopify-buy__product__variant-img")].map(child => ({
                className: child.className, box: child.getBoundingClientRect().toJSON(),
                height: getComputedStyle(child).height, minHeight: getComputedStyle(child).minHeight,
                inlineStyle: child.getAttribute("style"),
            })),
            matchedRules: [...document.styleSheets].flatMap(sheet => {
                try { return [...sheet.cssRules].map(rule => rule.cssText).filter(text => text.includes("shopify-buy__modal")); }
                catch { return []; }
            }),
        };
    });
    console.log("PRODUCT_PREVIEW_RUNTIME", JSON.stringify({
        viewport: diagnostic.viewport, panel: diagnostic.panel, background: diagnostic.background,
    }));
    const screenshot = testInfo.outputPath("product-preview.png");
    await page.screenshot({ path: screenshot });
    await testInfo.attach("product-preview", { path: screenshot, contentType: "image/png" });
    await testInfo.attach("product-preview-runtime", {
        body: JSON.stringify(diagnostic, null, 2), contentType: "application/json",
    });
    if (testInfo.project.name !== "mobile-iphone-chromium") {
        expect(diagnostic.panel.height).toBeLessThanOrEqual(diagnostic.viewport.height * 0.65);
        expect(diagnostic.background).toBe("rgba(255, 253, 247, 0.9)");
        expect(diagnostic.panel.y).toBeGreaterThan(0);
        expect(diagnostic.panel.bottom).toBeLessThan(diagnostic.viewport.height);
        await expect(frame.locator(".shopify-buy__product__title")).toHaveCSS("color", "rgb(36, 36, 36)");
    } else {
        // Preserve the existing opaque, fullscreen Mobile presentation.
        expect(diagnostic.background).toBe("rgb(255, 253, 247)");
        expect(diagnostic.panel.height).toBe(diagnostic.viewport.height);
    }
    const close = frame.locator(".shopify-buy__btn--close");
    await expect(close).toBeVisible();
    await expect(close).toHaveCSS("width", "36px");
    await expect(close).toHaveCSS("height", "36px");
    await expect(close).toHaveCSS("border-radius", "50%");
    await expect(close).toHaveCSS("border-width", "0px");
    await close.blur();
    await expect(close).toHaveCSS("background-color", "rgb(74, 74, 74)");
    await expect(close).toHaveCSS("background-size", "10px 10px, 10px 10px");
    await expect(close).toHaveCSS("box-shadow", "none");
    await close.focus();
    await expect(close).toHaveCSS("outline-style", "none");
    await expect(close).toHaveCSS("background-color", "rgb(90, 90, 90)");
    await expect(add).toBeInViewport();
    await close.click();
    await expect(page.locator(".shopify-buy-frame--modal")).toBeHidden();
}

test("Buy now preview keeps a compact translucent desktop and tablet panel", checkProductPreview);

test.describe("iPad landscape", () => {
    test.use({ viewport: { width: 1366, height: 1024 }, hasTouch: true });
    test("keeps the tablet preview contract on a wide touch viewport", async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== "tablet-ipad-chromium", "Tablet-only landscape coverage");
        await checkProductPreview({ page }, testInfo);
    });
});
