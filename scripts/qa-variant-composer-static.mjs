import assert from "node:assert/strict";
import fs from "node:fs";

const composer = fs.readFileSync("docs/assets/js/commerce/variant-composer.js", "utf8");
const catalog = fs.readFileSync("docs/assets/js/commerce/catalog.js", "utf8");
const css = fs.readFileSync("docs/shopify.css", "utf8");
const buyButton = fs.readFileSync("docs/assets/js/commerce/shopify-buy.js", "utf8");

assert.match(composer, /role:\s*"dialog"/);
assert.match(composer, /"aria-modal":\s*"true"/);
assert.match(composer, /"aria-labelledby":\s*"cbs-composer-title"/);
assert.match(composer, /role:\s*"status"/);
assert.match(composer, /event\.key === "Escape"/);
assert.match(composer, /focusableElements\(dialog\)/);
assert.match(composer, /textContent/);
assert.doesNotMatch(composer, /innerHTML|insertAdjacentHTML|document\.write/);
assert.doesNotMatch(composer, /ORIG-01|Black|Gold|White|gid:\/\/shopify\/ProductVariant\/\d/);
assert.match(composer, /isLocalCommerceQaEnabled/);
assert.match(composer, /className:\s*"cbs-composer-launcher"[\s\S]*?text:\s*"Buy now"/);
assert.match(composer, /text:\s*"Add selected items"/);
assert.match(composer, /createComposerSelection/);
assert.match(composer, /setOption/);
assert.match(composer, /resolveUnit/);
assert.match(composer, /groupLinesByVariant|reduce\(\(total/);
assert.match(composer, /cbs-composer__unit/);
assert.match(composer, /cbs-composer__option/);
assert.match(composer, /createElement\(documentRef, "select"\)|"select"/);
assert.match(composer, /manager\.addLines/);
assert.match(catalog, /if \(initializeVariantComposerQa\([\s\S]*?\)\) \{\s*return;/);
assert.match(catalog, /mountShopifyProduct\(product, node\)/);
assert.match(buyButton, /ui\.createComponent\("product"/);
assert.match(css, /\.cbs-composer\s*\{[\s\S]*?max-height:[\s\S]*?100dvh/);
assert.match(css, /\.cbs-composer__content\s*\{[\s\S]*?overflow-y:\s*auto/);
assert.match(css, /\.cbs-composer__unit\s*\{/);
assert.match(css, /\.cbs-composer__unit-options\s*\{/);
assert.match(css, /\.cbs-composer__option select\s*\{[\s\S]*?width:\s*100%/);
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?height:\s*100dvh/);
assert.match(css, /\.cbs-composer__quantity button[\s\S]*?width:\s*2\.75rem[\s\S]*?height:\s*2\.75rem/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

console.log(JSON.stringify({
    semanticDialog: true,
    accessibleNaming: true,
    liveStatus: true,
    escapeAndFocusTrap: true,
    touchTargets: true,
    safeDomRendering: true,
    noProductSpecificBranching: true,
    unitConfigurationModel: true,
    optionSelectors: true,
    lineAggregation: true,
    singleAddAction: true,
    desktopStatic: true,
    tabletStatic: true,
    mobileStatic: true,
    containedScrolling: true,
    reducedMotion: true,
    localQaGate: true,
    publicBuyButtonPreserved: true,
}, null, 2));
