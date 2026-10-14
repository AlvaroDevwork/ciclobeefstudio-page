const { expect, test } = require("@playwright/test");

test("Studio Store product arrows stay horizontally centered", async ({ page }, testInfo) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("#products").scrollIntoViewIfNeeded();

    const panel = page.locator(".cbs-store-group:not([hidden])");
    const pager = panel.locator(".cbs-store-pager");
    const previous = pager.locator("[data-store-prev]");
    const next = pager.locator("[data-store-next]");

    await expect(pager).toBeVisible();
    await expect(previous).toBeVisible();
    await expect(next).toBeVisible();

    const [panelBox, pagerBox] = await Promise.all([
        panel.boundingBox(),
        pager.boundingBox(),
    ]);
    expect(panelBox).not.toBeNull();
    expect(pagerBox).not.toBeNull();

    if (testInfo.project.name === "desktop-chromium") {
        const panelCenter = panelBox.x + (panelBox.width / 2);
        const pagerCenter = pagerBox.x + (pagerBox.width / 2);
        expect(Math.abs(panelCenter - pagerCenter)).toBeLessThanOrEqual(1);
    }

    for (const arrow of [previous, next]) {
        const box = await arrow.boundingBox();
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
        await expect(arrow).toBeInViewport();
    }

    const screenshotPath = testInfo.outputPath("store-pager-centered.png");
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach("store-pager-centered", {
        path: screenshotPath,
        contentType: "image/png",
    });
});
