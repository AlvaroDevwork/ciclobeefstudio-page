const { expect, test } = require("@playwright/test");

const EXPECTED_COPY = {
    heading: "Refined Art for Modern Spaces",
    supporting: "Curated objects with character.",
    cta: "Explore the Collection",
};

test("seasonal Hero transitions once from the aligned OFF layer to the ON layer", async ({ page }) => {
    await page.addInitScript(() => {
        const nativeSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) => {
            if (delay === 1500) {
                window.__heroActivationDelay = delay;
                window.__activateSeasonalHero = () => callback(...args);
                return 1500;
            }

            return nativeSetTimeout(callback, delay, ...args);
        };
    });
    await page.goto("/?cbs-cart-qa=1", { waitUntil: "domcontentloaded" });

    const hero = page.locator("#hero");
    const stage = hero.locator("[data-hero-tree]");
    const offImage = stage.locator(".hero-tree-image-off");
    const onImage = stage.locator(".hero-tree-image-on");
    const glow = stage.locator(".hero-tree-glow");

    await expect(hero.locator("h1")).toHaveText(EXPECTED_COPY.heading);
    await expect(hero.locator(".hero-copy > p")).toHaveText(EXPECTED_COPY.supporting);
    await expect(hero.locator("#scrollBtn")).toHaveText(EXPECTED_COPY.cta);
    await expect(stage).toHaveCount(1);
    await expect(offImage).toHaveAttribute("src", "assets/images/hero/hero-holiday-cross-tree-off.png");
    await expect(onImage).toHaveAttribute("src", "assets/images/hero/CBS-HERO-U01-CROSS-TREE-GLOW.png");
    await expect(offImage).not.toHaveAttribute("alt", "");
    await expect(onImage).toHaveAttribute("alt", "");
    await expect(onImage).toHaveAttribute("aria-hidden", "true");
    await expect(glow).toHaveAttribute("aria-hidden", "true");

    const initial = await stage.evaluate(node => {
        const off = node.querySelector(".hero-tree-image-off");
        const on = node.querySelector(".hero-tree-image-on");
        const halo = node.querySelector(".hero-tree-glow");
        return {
            illuminated: node.classList.contains("is-illuminated"),
            offOpacity: getComputedStyle(off).opacity,
            onOpacity: getComputedStyle(on).opacity,
            glowOpacity: getComputedStyle(halo).opacity,
            offRect: off.getBoundingClientRect().toJSON(),
            onRect: on.getBoundingClientRect().toJSON(),
            offFit: getComputedStyle(off).objectFit,
            onFit: getComputedStyle(on).objectFit,
            offTransform: getComputedStyle(off).transform,
            onTransform: getComputedStyle(on).transform,
            imagesComplete: off.complete && on.complete,
        };
    });

    expect(initial).toMatchObject({
        illuminated: false,
        offOpacity: "1",
        onOpacity: "0",
        glowOpacity: "0",
        offFit: "contain",
        onFit: "contain",
        offTransform: "none",
        onTransform: "none",
        imagesComplete: true,
    });
    expect(initial.offRect).toEqual(initial.onRect);
    expect(await page.evaluate(() => window.__heroActivationDelay)).toBe(1500);

    await page.waitForTimeout(1300);
    expect(await stage.evaluate(node => node.classList.contains("is-illuminated"))).toBe(false);

    await page.evaluate(() => window.__activateSeasonalHero());
    await expect(stage).toHaveClass(/is-illuminated/);
    await page.waitForTimeout(1500);
    await expect(offImage).toHaveCSS("opacity", "0");
    await expect(onImage).toHaveCSS("opacity", "1");
    await expect(glow).toHaveCSS("opacity", "1");

    await page.waitForTimeout(500);
    await expect(stage).toHaveClass(/is-illuminated/);
    await expect(onImage).toHaveCSS("opacity", "1");

    const layout = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        ctaVisible: Boolean(document.getElementById("scrollBtn")?.getClientRects().length),
        heroProductSystems: document.querySelectorAll("#hero [data-hero-tree]").length,
    }));
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.ctaVisible).toBe(true);
    expect(layout.heroProductSystems).toBe(1);
});

test("reduced motion shows the stable ON state without the delayed sequence", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?cbs-cart-qa=1", { waitUntil: "domcontentloaded" });

    const stage = page.locator("[data-hero-tree]");
    await expect(stage).toHaveClass(/is-illuminated/);
    await expect(stage.locator(".hero-tree-image-off")).toHaveCSS("opacity", "0");
    await expect(stage.locator(".hero-tree-image-on")).toHaveCSS("opacity", "1");
    await expect(stage.locator(".hero-tree-glow")).toHaveCSS("opacity", "1");
});
