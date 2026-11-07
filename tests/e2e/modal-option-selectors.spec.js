const { expect, test } = require("@playwright/test");

async function checkOptionPresentation({ page }, testInfo) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("#products").scrollIntoViewIfNeeded();
    const buy = page.frameLocator(".shopify-buy-frame--product iframe").first().getByRole("button", { name: /buy now/i });
    await expect(buy).toBeVisible({ timeout: 40_000 });
    await buy.click();
    const modal = page.frameLocator(".shopify-buy-frame--modal iframe");
    await expect(modal.locator(".shopify-buy__modal")).toBeVisible();
    if (testInfo.project.name === "desktop-chromium") {
        await expect(modal.locator(".cbs-modal-option")).toHaveCount(0);
        await expect(modal.locator("select").first()).toBeVisible();
        return;
    }
    const selector = modal.locator(".cbs-modal-option").first();
    const summary = selector.locator("summary");
    const panel = modal.locator(".shopify-buy__modal");
    await expect(summary).toBeVisible();
    const panelBefore = await panel.boundingBox();
    await summary.click();
    await expect(selector.locator("button").last()).toBeInViewport();
    const panelAfter = await panel.boundingBox();
    expect(panelAfter).toEqual(panelBefore);
    const geometry = await selector.evaluate(node => {
        const field = node.querySelector("summary").getBoundingClientRect();
        const list = node.querySelector(".cbs-modal-option-values").getBoundingClientRect();
        return { gap: list.top - field.bottom, left: list.left - field.left, width: list.width - field.width,
            fontSize: getComputedStyle(node.querySelector("button")).fontSize,
            height: node.querySelector("button").getBoundingClientRect().height };
    });
    expect(geometry.gap).toBe(6);
    expect(geometry.left).toBe(0);
    expect(geometry.width).toBe(0);
    expect(geometry.fontSize).toBe("16px");
    expect(geometry.height).toBeGreaterThanOrEqual(48);
    await page.screenshot({ path: testInfo.outputPath("options-open.png") });
    const choice = selector.locator('button[aria-pressed="false"]:enabled').first();
    const name = await choice.textContent();
    await choice.click();
    await expect(summary).toHaveText(name);
    await expect(modal.locator("select").first().locator("option:checked")).toHaveText(name);
    await expect(selector).not.toHaveAttribute("open", "");
    await summary.click();
    await summary.press("Escape");
    await expect(selector).not.toHaveAttribute("open", "");
    await expect(summary).toBeFocused();
}

test("Buy now keeps touch options beside their field and preserves Shopify selection", checkOptionPresentation);

for (const viewport of [{ width: 320, height: 568 }, { width: 1366, height: 1024 }]) {
    test.describe(`touch ${viewport.width}x${viewport.height}`, () => {
        test.use({ viewport, hasTouch: true });
        test("options remain anchored at touch viewport limits", async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== "mobile-iphone-chromium", "Run once per touch size");
            await checkOptionPresentation({ page }, testInfo);
        });
    });
}

test("all catalog modals use the same touch options, including Signature material changes", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "desktop-chromium", "Touch presentation only");
    test.setTimeout(240_000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("#products").scrollIntoViewIfNeeded();
    const tabs = page.locator("[data-store-tab]");
    for (let group = 0; group < await tabs.count(); group++) {
        await tabs.nth(group).click();
        const cards = page.locator(".cbs-store-group:not([hidden]) .cbs-product-card");
        for (let index = 0; index < await cards.count(); index++) {
            const card = cards.nth(index);
            await card.scrollIntoViewIfNeeded();
            const buy = card.locator(".cbs-commerce-mount:not([hidden])").frameLocator("iframe").getByRole("button", { name: /buy now/i });
            await expect(buy).toBeVisible({ timeout: 40_000 });
            await buy.click();
            const modal = page.frameLocator(".shopify-buy-frame--modal iframe");
            await expect(modal.locator(".shopify-buy__modal")).toBeVisible();
            const selects = modal.locator(".shopify-buy__option-select select");
            await expect.poll(() => modal.locator(".cbs-modal-option").count()).toBe(await selects.count());
            for (let field = 0; field < await selects.count(); field++) {
                const control = modal.locator(".cbs-modal-option").nth(field);
                await control.locator("summary").click();
                await expect(control.locator(".cbs-modal-option-values")).toBeVisible();
                await expect(control.locator("button")).toHaveCount(await selects.nth(field).locator("option").count());
                await control.locator("summary").press("Escape");
            }
            if (await modal.locator('select[name="Material"]').count()) {
                for (const [field, value] of [["Orientation", "Horizontal"], ["Material", "Signature Acrylic"], ["Material", "Signature Frame"]]) {
                    const control = modal.locator(".shopify-buy__option-select").filter({ has: modal.locator(`select[name="${field}"]`) });
                    await control.locator("summary").click();
                    await control.getByRole("button", { name: value, exact: true }).click();
                    await expect(control.locator("summary")).toHaveText(value);
                    await expect(modal.locator('select[name="Orientation"]')).toHaveValue("Horizontal");
                    await expect(modal.locator(".shopify-buy__modal")).toBeVisible();
                }
            }
            await modal.locator(".shopify-buy__btn--close").click();
        }
    }
});
