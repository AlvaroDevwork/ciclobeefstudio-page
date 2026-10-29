const { expect, test } = require("@playwright/test");
const { diagnoseInspection, inspectElement } = require("./helpers/inspect-element.js");

const QA_PATH = "/?cbs-cart-qa=1";
const CART_STORAGE_KEY = "cbs.commerce.cart.v1";

test("Buy Button Cart provides a working trash control for each line", async ({ page }, testInfo) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("#products").scrollIntoViewIfNeeded();
    const productFrame = page.frameLocator('.shopify-buy-frame--product iframe').first();
    await productFrame.getByRole("button", { name: /buy now/i }).click();
    const modal = page.frameLocator('.shopify-buy-frame--modal iframe');
    await modal.getByRole("button", { name: /add to cart/i }).click();
    const cart = page.frameLocator('.shopify-buy-frame--cart iframe');
    const lines = cart.locator('.shopify-buy__cart-item');
    await expect(lines.first()).toBeVisible();
    // This is the public Buy Button iframe cart, not the separate CBS QA cart.
    // Cover more than one line on Desktop to guard line-specific removal.
    const expectedLines = testInfo.project.name === "desktop-chromium" ? 2 : 1;
    if (expectedLines === 2) {
        await cart.locator('.shopify-buy__btn--close').click();
        await page.frameLocator('.shopify-buy-frame--product iframe').nth(1)
            .getByRole("button", { name: /buy now/i }).click();
        await modal.getByRole("button", { name: /add to cart/i }).click();
    }
    await expect(lines).toHaveCount(expectedLines);
    await expect(cart.locator('.cbs-buy-cart__remove')).toHaveCount(expectedLines);
    for (let index = 0; index < expectedLines; index += 1) {
        const button = lines.nth(index).locator('.cbs-buy-cart__remove');
        await expect(button).toBeVisible();
        await expect(button).toBeEnabled();
        await expect(button).toBeInViewport();
        await expect(button.locator('svg')).toBeVisible();
        const box = await button.boundingBox();
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
    }
    const titles = await lines.locator('.shopify-buy__cart-item__title').allTextContents();
    const remove = lines.first().locator('.cbs-buy-cart__remove');
    await expect(remove).toBeVisible();
    await expect(remove).toBeEnabled();
    await expect(remove.locator('svg')).toBeVisible();
    await expect(remove).toBeInViewport();
    const screenshotPath = testInfo.outputPath('buy-button-cart.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('buy-button-cart', { path: screenshotPath, contentType: 'image/png' });
    await remove.click();
    await expect(lines).toHaveCount(expectedLines - 1);
    if (expectedLines === 2) {
        await expect(lines.locator('.shopify-buy__cart-item__title')).toHaveText(titles[1]);
        await lines.locator('.cbs-buy-cart__remove').click();
        await expect(lines).toHaveCount(0);
    }
});

async function waitForCartHydration(page) {
    await page.waitForFunction(() => Boolean(window.CBSCartQA?.ready));
    await page.evaluate(() => window.CBSCartQA.ready.then(() => true));
}

async function selectNextComposerOption(dialog) {
    const selects = dialog.locator("select");
    const count = await selects.count();
    for (let index = 0; index < count; index += 1) {
        const select = selects.nth(index);
        const candidate = await select.evaluate(element => {
            const current = element.value;
            if (current) return null;
            return Array.from(element.options).find(option => option.value && !option.disabled)?.value ?? null;
        });
        if (candidate) {
            await select.selectOption(candidate);
            return true;
        }
    }
    return false;
}

async function goToProducts(page) {
    const products = page.locator("#products");
    await products.scrollIntoViewIfNeeded();
    await expect(products).toBeVisible();
    await expect(products).toBeInViewport();
}

async function addProductThroughComposer(page, { excludedProductKeys = [] } = {}) {
    await page.locator("#products").scrollIntoViewIfNeeded();
    const launchers = page.locator(".cbs-composer-launcher:visible");
    await expect(launchers.first()).toBeVisible();

    for (let productIndex = 0; productIndex < await launchers.count(); productIndex += 1) {
        const launcher = launchers.nth(productIndex);
        const productKey = await launcher.evaluate(node => (
            node.closest("[data-shopify-product-key]")?.dataset.shopifyProductKey ?? null
        ));
        if (!productKey || excludedProductKeys.includes(productKey)) continue;

        await launcher.click();
        const composerRoot = page.locator(".cbs-composer-qa");
        const dialog = page.locator(".cbs-composer");
        const addButton = dialog.locator(".cbs-composer__add");
        await expect(composerRoot).toHaveJSProperty("hidden", false);
        await expect(dialog).toBeVisible();
        await expect(dialog).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 });

        for (let optionStep = 0; optionStep < 12 && await addButton.isDisabled(); optionStep += 1) {
            if (!await selectNextComposerOption(dialog)) break;
        }

        if (await addButton.isEnabled()) {
            await addButton.click();
            await expect(composerRoot).toHaveJSProperty("hidden", true, { timeout: 30_000 });
            await expect(page.locator(".cbs-cart")).toBeVisible();
            await expect(page.locator(".cbs-cart-line").first()).toBeVisible();
            return productKey;
        }

        await page.evaluate(() => window.CBSVariantComposerQA?.close());
    }

    throw new Error("No catalog product could be deterministically configured through the QA Composer.");
}

async function inspectCart(page, label) {
    const root = page.locator(".cbs-cart");
    const close = page.locator(".cbs-cart__icon-button");
    const lines = page.locator(".cbs-cart-line");
    const trashButtons = page.locator(".cbs-cart-line__remove");
    const trashIcons = page.locator(".cbs-cart-line__remove-icon");
    const actions = page.locator(".cbs-cart-line__actions");
    const rootCount = await root.count();
    const lineCount = await lines.count();
    const rootInspection = await inspectElement(root);
    const closeInspection = await inspectElement(close);
    const environment = await page.evaluate(storageKey => {
        let cartReference = null;
        try {
            const parsed = JSON.parse(localStorage.getItem(storageKey));
            cartReference = parsed && {
                version: parsed.version,
                hasCartId: typeof parsed.id === "string" && parsed.id.startsWith("gid://shopify/Cart/"),
            };
        } catch {
            cartReference = { invalid: true };
        }
        return {
            url: location.href,
            devicePixelRatio: window.devicePixelRatio,
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            outerWidth: window.outerWidth,
            outerHeight: window.outerHeight,
            visualViewport: window.visualViewport && {
                width: window.visualViewport.width,
                height: window.visualViewport.height,
                scale: window.visualViewport.scale,
            },
            bodyClass: document.body.className,
            cartReference,
        };
    }, CART_STORAGE_KEY);
    const trash = [];

    for (let index = 0; index < lineCount; index += 1) {
        const button = await inspectElement(trashButtons.nth(index));
        const icon = await inspectElement(trashIcons.nth(index));
        const parentActions = await inspectElement(actions.nth(index));
        trash.push({
            index,
            button,
            icon,
            parentActions,
            diagnostic: diagnoseInspection(button),
        });
    }

    const result = {
        label,
        viewport: page.viewportSize(),
        environment,
        rootCount,
        root: rootInspection,
        lineCount,
        close: closeInspection,
        trashButtonCount: await trashButtons.count(),
        trashIconCount: await trashIcons.count(),
        trash,
    };
    console.log(`CBS_CART_RUNTIME ${JSON.stringify(result)}`);

    expect.soft(rootCount, `${label}: one authoritative CBS Cart root`).toBe(1);
    expect.soft(lineCount, `${label}: cart contains lines`).toBeGreaterThan(0);
    expect.soft(closeInspection.exists, `${label}: close X exists`).toBe(true);
    expect.soft(closeInspection.visible, `${label}: close X is visible`).toBe(true);
    expect.soft(closeInspection.nonZeroBoundingBox, `${label}: close X has a non-zero box`).toBe(true);
    expect.soft(closeInspection.centerHitTarget, `${label}: close X center is hit-testable`).toBe(true);
    expect.soft(closeInspection.attributes?.disabled, `${label}: close X is enabled`).toBe(false);
    expect.soft(result.trashButtonCount, `${label}: trash button per line`).toBe(lineCount);
    expect.soft(result.trashIconCount, `${label}: trash icon per line`).toBe(lineCount);

    for (const item of trash) {
        expect.soft(item.button.visible, `${label}: trash button ${item.index} visible (${item.diagnostic})`).toBe(true);
        expect.soft(item.button.nonZeroBoundingBox, `${label}: trash button ${item.index} has a non-zero box`).toBe(true);
        expect.soft(item.button.insideViewport, `${label}: trash button ${item.index} intersects viewport`).toBe(true);
        expect.soft(item.button.centerHitTarget, `${label}: trash button ${item.index} center is hit-testable`).toBe(true);
        expect.soft(item.button.attributes?.disabled, `${label}: trash button ${item.index} is enabled`).toBe(false);
        expect.soft(item.icon.exists, `${label}: trash icon ${item.index} exists`).toBe(true);
        expect.soft(item.icon.visible, `${label}: trash icon ${item.index} visible`).toBe(true);
        expect.soft(item.icon.nonZeroBoundingBox, `${label}: trash icon ${item.index} has a non-zero box`).toBe(true);
    }

    return result;
}

async function assertCartCommerceControls(page, label) {
    await expect.soft(page.locator(".cbs-cart-line__quantity").first(), `${label}: quantity`).toBeVisible();
    await expect.soft(page.locator(".cbs-cart-qa__badge"), `${label}: badge`).toBeVisible();
    await expect.soft(page.locator(".cbs-cart__subtotal"), `${label}: subtotal`).toBeVisible();
    await expect.soft(page.locator(".cbs-cart__checkout"), `${label}: checkout`).toBeVisible();
}

async function closeCart(page) {
    await page.evaluate(() => window.CBSCartQA.close());
    await expect(page.locator(".cbs-cart")).toBeHidden();
}

async function openPersistedCart(page) {
    await goToProducts(page);
    await page.locator(".cbs-cart-qa__launcher").click();
    await expect(page.locator(".cbs-cart")).toBeVisible();
    await expect(page.locator(".cbs-cart-line").first()).toBeVisible();
}

test("CBS Cart controls remain inspectable across viewport and reload lifecycle", async ({ page }, testInfo) => {
    await page.goto(QA_PATH, { waitUntil: "domcontentloaded" });
    await waitForCartHydration(page);
    const firstProductKey = await addProductThroughComposer(page);

    if (testInfo.project.name === "desktop-chromium") {
        await closeCart(page);
        await goToProducts(page);
        await addProductThroughComposer(page, { excludedProductKeys: [firstProductKey] });
        await expect(page.locator(".cbs-cart-line")).toHaveCount(2);
        await expect(page.locator(".cbs-cart-line__remove")).toHaveCount(2);
    }

    const freshResult = await inspectCart(page, `${testInfo.project.name}:fresh`);
    if (testInfo.project.name === "desktop-chromium") {
        expect.soft(freshResult.lineCount, "Desktop Buy now flow creates two distinct Cart lines").toBe(2);
        expect.soft(freshResult.trashButtonCount, "Desktop renders one trash control per product line").toBe(2);
    }
    await assertCartCommerceControls(page, `${testInfo.project.name}:fresh`);

    for (let reload = 1; reload <= 3; reload += 1) {
        await closeCart(page);
        await page.locator('.nav-logo[href="#hero"]').click();
        await expect(page.locator("#hero")).toBeInViewport();
        await page.reload({ waitUntil: "domcontentloaded" });
        await waitForCartHydration(page);
        await openPersistedCart(page);
        await inspectCart(page, `${testInfo.project.name}:reload-${reload}`);
        await assertCartCommerceControls(page, `${testInfo.project.name}:reload-${reload}`);
    }
});
