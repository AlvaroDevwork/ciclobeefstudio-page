import assert from "node:assert/strict";
import fs from "node:fs";

// Static regression guard for the CBS Cart contract.
// Fails the run if any protected cart control or the hidden-cart fix is
// removed from source, so a future edit cannot silently regress the
// Human-approved cart visual contract.

const cartUi = fs.readFileSync("docs/assets/js/commerce/cart-ui.js", "utf8");
const cartManager = fs.readFileSync("docs/assets/js/commerce/cart.js", "utf8");
const css = fs.readFileSync("docs/shopify.css", "utf8");

// Close X control
assert.match(cartUi, /className:\s*"cbs-cart__icon-button"/, "Close X button must be rendered by the cart UI.");
assert.match(cartUi, /"aria-label":\s*"Close cart"/, "Close X must expose an accessible label.");
assert.match(cartUi, /closeButton\.addEventListener\("click",\s*closeCart\)/, "Close X must stay wired to the close handler.");

// Trash / remove control
assert.match(cartUi, /className:\s*"cbs-cart-line__remove"/, "Line remove button must be rendered.");
assert.match(cartUi, /trashIcon\(documentRef\)/, "The remove button must render the trash SVG.");
assert.match(cartUi, /stroke:\s*"currentColor"/, "The trash SVG must inherit a visible stroke color.");
assert.match(cartUi, /"M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/, "The trash SVG path must remain present.");
assert.match(cartUi, /removeLine\(line\)/, "The remove button must call the line removal handler.");
assert.match(cartUi, /manager\.removeLines\(\[line\.id\]\)/, "Removal must target the specific cart line ID.");

// Responsive visual contract: these controls use one canonical rule set. No
// breakpoint may hide them, collapse their hit areas, or remove the SVG.
assert.match(css, /\.cbs-cart-line__remove\s*\{[^}]*display:\s*inline-grid;[^}]*width:\s*2\.75rem;[^}]*height:\s*2\.75rem;/s, "The trash control must keep its visible desktop hit area.");
assert.match(css, /\.cbs-cart-line__remove-icon\s*\{[^}]*display:\s*block;[^}]*width:\s*1\.25rem;[^}]*height:\s*1\.25rem;/s, "The trash SVG must keep explicit visible dimensions.");
assert.doesNotMatch(css, /\.cbs-cart-line__remove(?:-icon)?[^{}]*\{[^}]*(?:display:\s*none|visibility:\s*hidden|opacity:\s*0(?:\s*!important)?\s*;)/s, "No base or responsive rule may hide the trash control.");
assert.match(css, /\.cbs-cart__icon-button\s*\{[^}]*flex:\s*0\s+0\s+2\.75rem;[^}]*min-width:\s*2\.75rem;[^}]*min-height:\s*2\.75rem;/s, "The close X must keep its approved hit area.");
assert.doesNotMatch(css, /\.cbs-cart__icon-button[^{}]*\{[^}]*(?:display:\s*none|visibility:\s*hidden|opacity:\s*0(?:\s*!important)?\s*;)/s, "No base or responsive rule may hide the close X.");

// Quantity / badge / subtotal / checkout selectors
assert.match(cartUi, /"aria-label":\s*`Decrease quantity/, "Quantity decrease control must exist.");
assert.match(cartUi, /"aria-label":\s*`Increase quantity/, "Quantity increase control must exist.");
assert.match(cartUi, /className:\s*"cbs-cart__subtotal"/, "Subtotal control must exist.");
assert.match(cartUi, /className:\s*"cbs-cart__checkout"/, "Checkout control must exist.");
assert.match(cartUi, /className:\s*"cbs-cart-qa__badge"/, "Cart badge must exist.");

// Hidden-cart fix: the closed cart must not remain display-visible.
assert.match(css, /\.cbs-cart\[hidden\]\s*\{\s*display:\s*none;?\s*\}/, "The Cart-scoped hidden fix must be present so a closed cart is display:none.");

// No global [hidden] override was introduced (cart-scoped only).
assert.doesNotMatch(css, /\[\s*hidden\s*\]\s*\{\s*display:\s*none\s*!important/, "Do not introduce a global hidden override.");

console.log(JSON.stringify({
    closeXContract: true,
    trashContract: true,
    trashSvg: true,
    desktopTrashCssVisible: true,
    responsiveTrashHideRules: false,
    closeXHitArea: true,
    quantityControls: true,
    badge: true,
    subtotal: true,
    checkout: true,
    hiddenCartFix: true,
    cartScopedOnly: true,
}, null, 2));
