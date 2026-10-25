const { expect, test } = require("@playwright/test");

const STORE_CATEGORIES = [
    "Christmas Collection",
    "CBS Signature Wall Art",
    "Faith & Meaning",
];

const WALL_ART_AND_LIVING_PRESENTATIONS = [
    { key: "ORIG-01", previewIndex: "0", title: "Aereocrya Dreams", materialMountCount: 2 },
    { key: "ORIG-01", previewIndex: "1", title: "Vesperocrya Dreams", materialMountCount: 2 },
    { key: "P11", previewIndex: "0", title: "13-in-1 Planetarium Projector", materialMountCount: 0 },
    { key: "N08", previewIndex: "0", title: "Retro World Globe Desk Decor", materialMountCount: 0 },
    { key: "N10", previewIndex: "0", title: "European Resin Horse Sculpture", materialMountCount: 0 },
    { key: "N11", previewIndex: "0", title: "Vintage Resin Horse Sculpture", materialMountCount: 0 },
    { key: "R01", previewIndex: "0", title: "Antique Bronze-Style Zodiac Horse Statue", materialMountCount: 0 },
    { key: "R03", previewIndex: "0", title: "Minimalist Wooden Wall Clock", materialMountCount: 0 },
    { key: "B1-02", previewIndex: "0", title: "Bohemian Ceramic Vase Set", materialMountCount: 0 },
    { key: "B1-03", previewIndex: "0", title: "Nordic Ceramic Bud Vase", materialMountCount: 0 },
    { key: "B1-04", previewIndex: "0", title: "Resin Victory Horse Statue", materialMountCount: 0 },
];

async function inspectSignatureCtas(card) {
    return card.evaluate(node => {
        const details = [...node.querySelectorAll("[data-signature-material]")].map(mount => {
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
                hidden: mount.hidden,
                display: style.display,
                occupiesLayout: mount.getClientRects().length > 0,
                visible,
                tabReachable: visible && frame.tabIndex >= 0 && button.tabIndex >= 0,
            };
        });

        return {
            iframeCount: details.filter(detail => detail.mounted).length,
            visibleBuyNowCount: details.filter(detail => detail.visible).length,
            tabReachableBuyNowCount: details.filter(detail => detail.tabReachable).length,
            secondary: details.find(detail => detail.material === "Signature Acrylic"),
        };
    });
}

test("Studio Store presents two coordinated Signature artwork cards without changing other cards", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("#products").scrollIntoViewIfNeeded();

    const tabs = page.locator("#products [data-store-tab]");
    await expect(tabs).toHaveCount(STORE_CATEGORIES.length);
    const subsectionLabels = await tabs.evaluateAll(nodes => nodes.map(node => node.textContent.trim()));
    expect(subsectionLabels).toEqual(STORE_CATEGORIES);

    const wallArtTab = page.locator('[data-store-tab="signature-art"]');
    await expect(wallArtTab).toHaveText("CBS Signature Wall Art");
    await wallArtTab.click();

    const wallArtPanel = page.locator('[data-store-panel="signature-art"]');
    await expect(wallArtPanel).toBeVisible();
    const cards = wallArtPanel.locator(".cbs-product-card");
    await expect(cards).toHaveCount(WALL_ART_AND_LIVING_PRESENTATIONS.length);
    await expect(cards.filter({ has: page.locator('[data-signature-artwork="Aereocrya Dreams"]') })).toHaveCount(1);
    await expect(cards.filter({ has: page.locator('[data-signature-artwork="Vesperocrya Dreams"]') })).toHaveCount(1);

    for (let index = 0; index < WALL_ART_AND_LIVING_PRESENTATIONS.length; index += 1) {
        const card = cards.nth(index);
        await card.scrollIntoViewIfNeeded();
        await expect.poll(() => card.locator("img").evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
        await expect(card.locator(".cbs-commerce-mount:not([hidden])")
            .frameLocator("iframe")
            .getByRole("button", { name: /buy now/i })).toBeVisible({ timeout: 40_000 });
    }

    const presentations = await cards.evaluateAll(cardNodes => cardNodes.map(card => {
        const mount = card.querySelector(".cbs-commerce-mount:not([hidden])");
        const image = card.querySelector(".cbs-product-card__media img");
        const rect = card.getBoundingClientRect();
        return {
            key: mount?.dataset.shopifyProductKey,
            previewIndex: mount?.dataset.catalogPreviewIndex,
            title: card.querySelector("h4")?.textContent.trim(),
            materialMountCount: card.querySelectorAll("[data-signature-material]").length,
            imageComplete: image?.complete,
            imageWidth: image?.naturalWidth,
            width: rect.width,
            height: rect.height,
        };
    }));

    expect(presentations.map(({ key, previewIndex, title, materialMountCount }) => ({
        key,
        previewIndex,
        title,
        materialMountCount,
    }))).toEqual(WALL_ART_AND_LIVING_PRESENTATIONS);
    expect(presentations.every(item => item.imageComplete && item.imageWidth > 0)).toBe(true);
    expect(presentations.every(item => item.width > 0 && item.height > 0)).toBe(true);
    expect(subsectionLabels).not.toContain("CBS Signature Frame");
    expect(subsectionLabels).not.toContain("CBS Signature Acrylic");
    expect(subsectionLabels).not.toContain("Objects & Living");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    const diagnostics = await page.evaluate(() => window.CBSCommerce.getDiagnostics());
    expect(diagnostics.uiCount).toBe(1);
    expect(diagnostics.signatureCoordinatorCount).toBe(2);
    expect(diagnostics.signatureCoordinators.every(context => context.componentCount === 2)).toBe(true);

    let signatureVisibleBuyNowTotal = 0;
    for (const artwork of ["Aereocrya Dreams", "Vesperocrya Dreams"]) {
        const card = cards.filter({ has: page.locator(`[data-signature-artwork="${artwork}"]`) });
        const ctas = await inspectSignatureCtas(card);
        signatureVisibleBuyNowTotal += ctas.visibleBuyNowCount;
        expect(ctas.iframeCount).toBe(2);
        expect(ctas.visibleBuyNowCount).toBe(1);
        expect(ctas.tabReachableBuyNowCount).toBe(1);
        expect(ctas.secondary).toMatchObject({
            material: "Signature Acrylic",
            mounted: true,
            hidden: true,
            display: "none",
            occupiesLayout: false,
            visible: false,
            tabReachable: false,
        });
    }
    expect(signatureVisibleBuyNowTotal).toBe(2);
    expect(Math.abs(presentations[0].height - presentations[1].height)).toBeLessThanOrEqual(1);

    const objectCard = cards.filter({ has: page.locator('[data-shopify-product-key="P11"]') });
    await objectCard.scrollIntoViewIfNeeded();
    await objectCard.frameLocator(".shopify-buy-frame--product iframe")
        .getByRole("button", { name: /buy now/i }).click();
    const modal = page.frameLocator(".shopify-buy-frame--modal iframe");
    await expect(modal.locator(".shopify-buy__product__title")).toHaveText("13-in-1 Planetarium Projector");
    await expect(modal.locator('select[name="Material"]')).toHaveCount(0);
    await modal.locator(".shopify-buy__btn--close").click();
    await expect(page.locator(".shopify-buy-frame--modal")).toBeHidden();
});
