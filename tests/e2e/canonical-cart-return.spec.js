const { expect, test } = require("@playwright/test");

test("canonical cart return fails safely and remains usable at every supported viewport", async ({ page }) => {
    const pageErrors = [];
    const externalNavigations = [];

    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("framenavigated", frame => {
        if (frame === page.mainFrame()) {
            const url = new URL(frame.url());
            if (url.origin !== "http://127.0.0.1:8000") externalNavigations.push(url.href);
        }
    });

    await page.goto("/cart/?next=https://evil.example/&return=javascript:alert(1)", {
        waitUntil: "domcontentloaded",
    });

    await expect(page).toHaveURL(/\/cart\/\?next=/);
    await expect(page.locator("[data-cart-return-status]")).toContainText("isn’t an active cart");
    await expect(page.locator("[data-cart-return-fallback]")).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue to the Studio Store" })).toHaveAttribute("href", "/#products");

    const layout = await page.evaluate(() => {
        const card = document.querySelector(".cbs-cart-return__card").getBoundingClientRect();
        return {
            viewportWidth: window.innerWidth,
            cardLeft: card.left,
            cardRight: card.right,
            cardWidth: card.width,
            horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
            liveRegion: document.querySelector("[data-cart-return-status]").getAttribute("aria-live"),
            cartFrames: document.querySelectorAll(".shopify-buy-frame--cart").length,
            sdkScripts: document.querySelectorAll("#cbs-shopify-buy-sdk").length,
        };
    });

    expect(layout.cardLeft).toBeGreaterThanOrEqual(0);
    expect(layout.cardRight).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.cardWidth).toBeGreaterThan(240);
    expect(layout.horizontalOverflow).toBe(false);
    expect(layout.liveRegion).toBe("polite");
    expect(layout.cartFrames).toBe(0);
    expect(layout.sdkScripts).toBe(0);

    await page.getByRole("link", { name: "Continue to the Studio Store" }).focus();
    await expect(page.getByRole("link", { name: "Continue to the Studio Store" })).toBeFocused();
    const outlineStyle = await page.getByRole("link", { name: "Continue to the Studio Store" })
        .evaluate(node => getComputedStyle(node).outlineStyle);
    expect(outlineStyle).not.toBe("none");

    expect(externalNavigations).toEqual([]);
    expect(pageErrors).toEqual([]);
});
