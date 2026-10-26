const { expect, test } = require("@playwright/test");

const EXPECTED_COPY = {
    heading: "Refined Art for Modern Spaces",
    supporting: "Curated objects with character.",
    cta: "Explore the Collection",
};

const HERO_ASSETS = {
    desktop: {
        off: "hero-holiday-cross-tree-off.png",
        on: "CBS-HERO-U01-CROSS-TREE-GLOW.png",
    },
    responsive: {
        off: "CBS-HERO-U01-CROSS-TREE-RESPONSIVE-OFF.png",
        on: "CBS-HERO-U01-CROSS-TREE-RESPONSIVE-ON.png",
    },
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

    const selectedAssets = await stage.evaluate(node => ({
        off: new URL(node.querySelector(".hero-tree-image-off").currentSrc).pathname,
        on: new URL(node.querySelector(".hero-tree-image-on").currentSrc).pathname,
        responsive: window.matchMedia("(max-width: 1024px)").matches,
    }));
    const expectedAssets = selectedAssets.responsive ? HERO_ASSETS.responsive : HERO_ASSETS.desktop;
    expect(selectedAssets.off).toContain(`/assets/images/hero/${expectedAssets.off}`);
    expect(selectedAssets.on).toContain(`/assets/images/hero/${expectedAssets.on}`);

    const inactiveAssets = selectedAssets.responsive ? HERO_ASSETS.desktop : HERO_ASSETS.responsive;
    expect(selectedAssets.off).not.toContain(inactiveAssets.off);
    expect(selectedAssets.on).not.toContain(inactiveAssets.on);

    const tabletComposition = await hero.evaluate(node => {
        const tablet = window.matchMedia("(min-width: 768px) and (max-width: 1024px)").matches;
        if (!tablet) {
            return { tablet };
        }

        const copy = node.querySelector(".hero-copy");
        const heading = copy.querySelector("h1");
        const supporting = copy.querySelector("p");
        const actions = copy.querySelector(".hero-actions");
        return {
            tablet,
            copyAlignment: getComputedStyle(copy).alignItems,
            headingAlignment: getComputedStyle(heading).textAlign,
            supportingAlignment: getComputedStyle(supporting).textAlign,
            headingSize: Number.parseFloat(getComputedStyle(heading).fontSize),
            supportingSize: Number.parseFloat(getComputedStyle(supporting).fontSize),
            actionsAlignment: getComputedStyle(actions).justifyContent,
            actionSize: Number.parseFloat(getComputedStyle(actions.querySelector("button")).fontSize),
        };
    });
    if (tabletComposition.tablet) {
        expect(tabletComposition).toMatchObject({
            copyAlignment: "center",
            headingAlignment: "center",
            supportingAlignment: "center",
            actionsAlignment: "center",
        });
        expect(tabletComposition.headingSize).toBeGreaterThan(53);
        expect(tabletComposition.supportingSize).toBeGreaterThan(20);
        expect(tabletComposition.actionSize).toBeGreaterThan(19);
    }

    const initial = await stage.evaluate(node => {
        const visualSlot = node.closest(".hero-visual-slot");
        const off = node.querySelector(".hero-tree-image-off");
        const on = node.querySelector(".hero-tree-image-on");
        const halo = node.querySelector(".hero-tree-glow");
        const midGlow = getComputedStyle(node, "::before");
        const nearGlow = getComputedStyle(node, "::after");
        const wideGlow = getComputedStyle(halo);
        const ambient = getComputedStyle(visualSlot, "::before");
        return {
            responsive: matchMedia("(max-width: 1024px)").matches,
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
            onFilter: getComputedStyle(on).filter,
            nearContent: nearGlow.content,
            nearOpacity: nearGlow.opacity,
            nearFilter: nearGlow.filter,
            nearMask: nearGlow.webkitMaskImage || nearGlow.maskImage,
            midContent: midGlow.content,
            midOpacity: midGlow.opacity,
            midFilter: midGlow.filter,
            midMask: midGlow.webkitMaskImage || midGlow.maskImage,
            wideOpacity: wideGlow.opacity,
            wideFilter: wideGlow.filter,
            wideMask: wideGlow.webkitMaskImage || wideGlow.maskImage,
            ambientContent: ambient.content,
            ambientOpacity: ambient.opacity,
            ambientFilter: ambient.filter,
            ambientBackground: ambient.backgroundImage,
            ambientWidth: Number.parseFloat(ambient.width),
            stageWidth: node.getBoundingClientRect().width,
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
    if (initial.responsive) {
        expect(initial.nearContent).not.toBe("none");
        expect(initial.midContent).not.toBe("none");
        expect(initial.nearOpacity).toBe("0");
        expect(initial.midOpacity).toBe("0");
        expect(initial.wideOpacity).toBe("0");
        expect(initial.nearFilter).toMatch(/blur\((12|14)px\)/);
        expect(initial.midFilter).toMatch(/blur\((23|28)px\)/);
        expect(initial.wideFilter).toMatch(/blur\((42|52)px\)/);
        expect(initial.nearMask).toContain("CBS-HERO-U01-CROSS-TREE-RESPONSIVE-ON.png");
        expect(initial.midMask).toContain("CBS-HERO-U01-CROSS-TREE-RESPONSIVE-ON.png");
        expect(initial.wideMask).toContain("CBS-HERO-U01-CROSS-TREE-RESPONSIVE-ON.png");
        expect(initial.onFilter).toBe("none");
        expect(initial.ambientContent).not.toBe("none");
        expect(initial.ambientOpacity).toBe("0");
        expect(initial.ambientFilter).toMatch(/blur\((48|68)px\)/);
        expect(initial.ambientBackground.match(/radial-gradient/g)).toHaveLength(5);
        expect(initial.ambientWidth).toBeGreaterThan(initial.stageWidth);
    } else {
        expect(initial.nearContent).not.toBe("none");
        expect(initial.midContent).not.toBe("none");
        expect(initial.nearOpacity).toBe("0");
        expect(initial.midOpacity).toBe("0");
        expect(initial.wideOpacity).toBe("0");
        expect(initial.nearFilter).toContain("blur(16px)");
        expect(initial.midFilter).toContain("blur(36px)");
        expect(initial.wideFilter).toContain("blur(66px)");
        expect(initial.nearMask).toContain("CBS-HERO-U01-CROSS-TREE-GLOW.png");
        expect(initial.midMask).toContain("CBS-HERO-U01-CROSS-TREE-GLOW.png");
        expect(initial.wideMask).toContain("CBS-HERO-U01-CROSS-TREE-GLOW.png");
        expect(initial.onFilter).toBe("none");
        expect(initial.ambientContent).not.toBe("none");
        expect(initial.ambientOpacity).toBe("0");
        expect(initial.ambientFilter).toContain("blur(76px)");
        expect(initial.ambientBackground.match(/radial-gradient/g)).toHaveLength(6);
        expect(initial.ambientWidth).toBeGreaterThan(initial.stageWidth);
    }
    expect(await page.evaluate(() => window.__heroActivationDelay)).toBe(1500);

    await page.waitForTimeout(1300);
    expect(await stage.evaluate(node => node.classList.contains("is-illuminated"))).toBe(false);

    await page.evaluate(() => window.__activateSeasonalHero());
    await expect(stage).toHaveClass(/is-illuminated/);
    await page.waitForTimeout(1500);
    await expect(offImage).toHaveCSS("opacity", "0");
    await expect(onImage).toHaveCSS("opacity", "1");

    const finalRects = await stage.evaluate(node => ({
        offRect: node.querySelector(".hero-tree-image-off").getBoundingClientRect().toJSON(),
        onRect: node.querySelector(".hero-tree-image-on").getBoundingClientRect().toJSON(),
        nearOpacity: getComputedStyle(node, "::after").opacity,
        midOpacity: getComputedStyle(node, "::before").opacity,
        wideOpacity: getComputedStyle(node.querySelector(".hero-tree-glow")).opacity,
        ambientOpacity: getComputedStyle(node.closest(".hero-visual-slot"), "::before").opacity,
    }));
    expect(finalRects.offRect).toEqual(initial.offRect);
    expect(finalRects.onRect).toEqual(initial.onRect);
    if (initial.responsive) {
        expect(Number.parseFloat(finalRects.nearOpacity)).toBeGreaterThan(0);
        expect(Number.parseFloat(finalRects.midOpacity)).toBeGreaterThan(0);
        expect(Number.parseFloat(finalRects.wideOpacity)).toBeGreaterThan(0);
        expect(Number.parseFloat(finalRects.ambientOpacity)).toBeGreaterThan(0);
    } else {
        expect(Number.parseFloat(finalRects.nearOpacity)).toBeGreaterThan(0);
        expect(Number.parseFloat(finalRects.midOpacity)).toBeGreaterThan(0);
        expect(Number.parseFloat(finalRects.wideOpacity)).toBeGreaterThan(0);
        expect(Number.parseFloat(finalRects.ambientOpacity)).toBeGreaterThan(0);
    }

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
    await expect.poll(async () => Number.parseFloat(await stage.locator(".hero-tree-glow").evaluate(node => getComputedStyle(node).opacity))).toBeGreaterThan(0);
});
