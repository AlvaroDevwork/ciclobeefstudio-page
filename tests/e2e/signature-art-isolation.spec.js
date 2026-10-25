const { expect, test } = require("@playwright/test");

const ORIENTATIONS = ["Vertical", "Horizontal"];
const SIZES = [
    "50x70 cm / 20x28″",
    "60x90 cm / 24x36″",
    "70x100 cm / 28x40″",
];
const MATERIALS = [
    { label: "Signature Frame", productId: "8296598536261", token: "FRM" },
    { label: "Signature Acrylic", productId: "8296938537029", token: "ACR" },
];
const ARTWORKS = [
    { name: "Aereocrya Dreams", token: "AER" },
    { name: "Vesperocrya Dreams", token: "VES" },
];

function optionValues(select) {
    return select.locator("option").allTextContents();
}

async function activeContext(page, artwork) {
    return page.evaluate(name => (
        window.CBSCommerce.getDiagnostics().signatureCoordinators.find(context => context.artwork === name)
    ), artwork);
}

async function contextMedia(modal) {
    return modal.locator('a[href*="CBS-SIG-"]').evaluateAll(links => (
        [...new Set(links.map(link => link.href))]
    ));
}

async function expectSinglePublicCta(card) {
    await expect(card.locator('[data-signature-material][data-shopify-mount-state="mounted"]'))
        .toHaveCount(2, { timeout: 40_000 });
    const result = await card.evaluate(node => {
        const states = [...node.querySelectorAll("[data-signature-material]")].map(mount => {
            const frame = mount.querySelector("iframe");
            const button = frame?.contentDocument?.querySelector("button");
            const style = getComputedStyle(mount);
            const visible = Boolean(
                button
                && style.display !== "none"
                && style.visibility !== "hidden"
                && mount.getClientRects().length,
            );
            return {
                material: mount.dataset.signatureMaterial,
                mounted: mount.dataset.shopifyMountState === "mounted" && Boolean(frame && button),
                visible,
                tabReachable: visible && frame.tabIndex >= 0 && button.tabIndex >= 0,
                occupiesLayout: mount.getClientRects().length > 0,
            };
        });
        return {
            mounted: states.filter(state => state.mounted).length,
            visible: states.filter(state => state.visible).length,
            tabReachable: states.filter(state => state.tabReachable).length,
            secondary: states.find(state => state.material === "Signature Acrylic"),
        };
    });

    expect(result.mounted).toBe(2);
    expect(result.visible).toBe(1);
    expect(result.tabReachable).toBe(1);
    expect(result.secondary).toMatchObject({
        mounted: true,
        visible: false,
        tabReachable: false,
        occupiesLayout: false,
    });
}

async function expectContext(page, modal, artwork, material, orientation, size) {
    const context = await activeContext(page, artwork.name);
    expect(context.activeMaterial).toBe(material.label);
    expect(context.productId).toBe(material.productId);
    expect(context.variantId).toMatch(/^\d+$/);
    expect(context.selectedOptions).toMatchObject({
        Artwork: artwork.name,
        Orientation: orientation,
        Size: size,
    });

    const media = await contextMedia(modal);
    expect(media).toHaveLength(2);
    expect(media.every(source => source.includes(`CBS-SIG-${artwork.token}-${material.token}-`))).toBe(true);
    expect(media.some(source => source.includes(`CBS-SIG-${artwork.token}-${material.token}-V`))).toBe(true);
    expect(media.some(source => source.includes(`CBS-SIG-${artwork.token}-${material.token}-H`))).toBe(true);
    return context.variantId;
}

test("Signature Material coordinator resolves the real 24-variant matrix and isolates state", async ({ page }, testInfo) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("#products").scrollIntoViewIfNeeded();
    await page.locator('[data-store-tab="signature-art"]').click();

    const resolvedVariants = new Set();

    for (const artwork of ARTWORKS) {
        const card = page.locator(`.cbs-product-card:has([data-signature-artwork="${artwork.name}"])`);
        await expect(card).toHaveCount(1);
        await card.scrollIntoViewIfNeeded();
        await expect(card.locator("h4")).toHaveText(artwork.name);
        await expect(card.locator(".cbs-product-card__media img")).toHaveAttribute("alt", new RegExp(artwork.name));
        const buyNow = card.locator(".cbs-commerce-mount:not([hidden])")
            .frameLocator("iframe")
            .getByRole("button", { name: /buy now/i });
        await expectSinglePublicCta(card);
        await buyNow.click();

        const modal = page.frameLocator(".shopify-buy-frame--modal iframe");
        await expect(modal.locator(".shopify-buy__modal")).toBeVisible({ timeout: 40_000 });
        const material = modal.locator('select[name="Material"]');
        const orientation = modal.locator('select[name="Orientation"]');
        const size = modal.locator('select[name="Size"]');
        const artworkSelect = modal.locator('select[name="Artwork"]');
        await expect(material).toBeVisible({ timeout: 40_000 });
        expect(await optionValues(material)).toEqual(MATERIALS.map(item => item.label));
        expect(await optionValues(orientation)).toEqual(ORIENTATIONS);
        expect(await optionValues(size)).toEqual(SIZES);
        expect(await optionValues(artworkSelect)).toEqual([artwork.name]);

        await orientation.selectOption("Horizontal");
        await size.selectOption({ label: SIZES[1] });
        await material.selectOption("Signature Acrylic");
        await expect(modal.locator('select[name="Material"]')).toHaveValue("Signature Acrylic");
        await expect(modal.locator('select[name="Orientation"]')).toHaveValue("Horizontal");
        await expect(modal.locator('select[name="Size"]')).toHaveValue(SIZES[1]);
        await expectContext(page, modal, artwork, MATERIALS[1], "Horizontal", SIZES[1]);
        await expectSinglePublicCta(card);

        await modal.locator('select[name="Material"]').selectOption("Signature Frame");
        await expect(modal.locator('select[name="Material"]')).toHaveValue("Signature Frame");
        await expect(modal.locator('select[name="Orientation"]')).toHaveValue("Horizontal");
        await expect(modal.locator('select[name="Size"]')).toHaveValue(SIZES[1]);
        await expectContext(page, modal, artwork, MATERIALS[0], "Horizontal", SIZES[1]);
        await expectSinglePublicCta(card);

        for (const materialContext of MATERIALS) {
            if (await modal.locator('select[name="Material"]').inputValue() !== materialContext.label) {
                await modal.locator('select[name="Material"]').selectOption(materialContext.label);
                await expect(modal.locator('select[name="Material"]')).toHaveValue(materialContext.label);
            }

            for (const orientationValue of ORIENTATIONS) {
                await modal.locator('select[name="Orientation"]').selectOption(orientationValue);

                for (const sizeValue of SIZES) {
                    await modal.locator('select[name="Size"]').selectOption({ label: sizeValue });
                    const variantId = await expectContext(
                        page,
                        modal,
                        artwork,
                        materialContext,
                        orientationValue,
                        sizeValue,
                    );
                    expect(resolvedVariants.has(variantId)).toBe(false);
                    resolvedVariants.add(variantId);
                }
            }
        }

        await modal.locator(".shopify-buy__btn--close").click();
        await expect(page.locator(".shopify-buy-frame--modal")).toBeHidden();
        await expectSinglePublicCta(card);

        await buyNow.click();
        await expect(modal.locator('select[name="Material"]')).toBeVisible({ timeout: 40_000 });
        await modal.locator('select[name="Material"]').selectOption("Signature Acrylic");
        await expect(modal.locator('select[name="Material"]')).toHaveValue("Signature Acrylic");
        await modal.locator(".shopify-buy__btn--close").click();
        await expect(page.locator(".shopify-buy-frame--modal")).toBeHidden();
        await expectSinglePublicCta(card);

        await buyNow.click();
        await expect(modal.locator('select[name="Material"]')).toHaveValue("Signature Frame");
        await modal.locator(".shopify-buy__btn--close").click();
        await expect(page.locator(".shopify-buy-frame--modal")).toBeHidden();
        await expectSinglePublicCta(card);
    }

    expect(resolvedVariants.size).toBe(24);
    const diagnostics = await page.evaluate(() => window.CBSCommerce.getDiagnostics());
    expect(diagnostics.uiCount).toBe(1);
    expect(diagnostics.cartRuntimeCount).toBe(1);
    expect(diagnostics.signatureCoordinatorCount).toBe(2);
    expect(diagnostics.signatureCoordinators.every(context => context.componentCount === 2)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    const screenshot = testInfo.outputPath("signature-art-isolation.png");
    await page.screenshot({ path: screenshot });
    await testInfo.attach("signature-art-isolation", { path: screenshot, contentType: "image/png" });
});

test("Frame and Acrylic add through the singleton public Buy Button cart", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Shared-cart invariant needs one runtime proof.");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("#products").scrollIntoViewIfNeeded();
    await page.locator('[data-store-tab="signature-art"]').click();
    const card = page.locator('.cbs-product-card:has([data-signature-artwork="Aereocrya Dreams"])');
    const buyNow = card.locator(".cbs-commerce-mount:not([hidden])")
        .frameLocator("iframe").getByRole("button", { name: /buy now/i });
    const modal = page.frameLocator(".shopify-buy-frame--modal iframe");
    const cart = page.frameLocator(".shopify-buy-frame--cart iframe");

    await card.scrollIntoViewIfNeeded();
    await buyNow.click();
    await expect(modal.locator('select[name="Material"]')).toBeVisible({ timeout: 40_000 });
    await modal.getByRole("button", { name: /add to cart/i }).click();
    await expect(cart.locator(".shopify-buy__cart-item")).toHaveCount(1);
    await cart.locator(".shopify-buy__btn--close").click();

    await buyNow.click();
    await expect(modal.locator('select[name="Material"]')).toBeVisible({ timeout: 40_000 });
    await modal.locator('select[name="Material"]').selectOption("Signature Acrylic");
    await expect(modal.locator('select[name="Material"]')).toHaveValue("Signature Acrylic");
    await modal.getByRole("button", { name: /add to cart/i }).click();

    const lines = cart.locator(".shopify-buy__cart-item");
    await expect(lines).toHaveCount(2);
    expect((await lines.locator(".shopify-buy__cart-item__title").allTextContents()).sort()).toEqual([
        "CBS Signature Acrylic",
        "CBS Signature Frame",
    ]);
    await expect(cart.getByRole("button", { name: /checkout/i })).toBeVisible();
    const diagnostics = await page.evaluate(() => window.CBSCommerce.getDiagnostics());
    expect(diagnostics.uiCount).toBe(1);
    expect(diagnostics.cartRuntimeCount).toBe(1);
});
