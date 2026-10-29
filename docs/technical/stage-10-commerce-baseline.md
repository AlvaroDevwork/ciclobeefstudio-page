# Stage 10 Commerce Baseline

Stage 10A–10B preserves the v0.6.9 landing page as the responsive baseline while introducing the reusable Shopify Buy Button commerce core.

## Immutable landing contracts

- Section IDs remain `hero`, `products`, `gallery`, `formats`, `process`, `quote`, `about`, and `contact`.
- The main header navigation is persistent; the former section-dot navigation was removed by the approved Stage 10E.1 human QA decision.
- Tablet and mobile navigation retain the hamburger menu, focus trap, scroll lock, and smooth section navigation.
- GSAP, ScrollTrigger, the hero reflection, Gallery controls, and reduced-motion behavior remain owned by `script.js`.
- Existing viewport-fit, safe-area spacing, image sizing, horizontal overflow, and breakpoint rules in `style.css` remain unchanged.

## Stage 10B integration boundary

- `assets/js/commerce/config.js` contains browser-safe Shopify configuration only.
- `assets/js/commerce/products.js` is the canonical 19-product registry.
- `assets/js/commerce/shopify-buy.js` owns the singleton SDK, client, UI, and shared-cart runtime.
- `assets/js/commerce/catalog.js` validates mount hooks and lazily initializes visible components with `IntersectionObserver`.
- `shopify.css` contains only commerce-prefixed integration styles.
- Stage 10A–10B initially attached commerce hooks only to the two existing Studio Edition presentations.

## Stage 10C–10D extension

- The canonical registry now carries verified customer-facing titles, editorial summaries, group assignments, and Shopify CDN presentation images for all nineteen products.
- `catalog.js` renders the complete store from that registry; product IDs and component IDs are not duplicated in HTML.
- The former two-item Studio Edition image browser is intentionally replaced by the complete catalog, and its unreachable JavaScript initializer is removed.
- Four customer-facing groups organize the store: Signature Art, Faith & Meaning, Objects & Living, and Christmas Collection.
- Each lightweight CBS card lazily mounts its Shopify product component as it approaches the viewport.
- The existing Gallery remains an editorial COL001 experience, with secondary links to the two signature editions.
- Formats now explicitly apply to Signature Art only; other product options remain authoritative in Shopify.
- Process describes discovery, shared cart, secure checkout, preparation, delivery, and tracking.
- Quote is reserved for custom, trade, bulk, institutional, and special-requirement enquiries.

## Stage 10E.1 viewport architecture

- The persistent header uses one safe-area-aware header offset for scroll padding and section scroll margins.
- Studio Store shows one category panel at a time through an accessible keyboard and touch category switcher.
- Each category uses a responsive, user-controlled scroll-snap pager: four cards on wide desktop, three on standard desktop, two on tablet, and one on mobile.
- Product positions are retained while switching categories, all nineteen registry entries remain reachable, and product components still mount lazily through the shared runtime.

## Stage 10E.1-R1 measured navigation and asset geometry

- Section navigation uses one deterministic coordinate calculation for every header destination: absolute section top minus the live rendered header bottom minus one shared visual-gap token.
- A `ResizeObserver` and viewport resize listener synchronize `--cbs-header-occupied-height`; safe-area and responsive header changes are therefore represented by measured layout rather than an assumed height.
- The Studio Store introduction contains only its eyebrow and title before the category selector. Purchase-assurance microcopy is intentionally omitted from this top zone.
- `CATALOG_IMAGE_ASPECT_RATIO`: `3 / 2`.
- `CATALOG_MEDIA_BOX_BEHAVIOR`: full card width, ratio-stable block size, centered content, clipped decorative background, and responsive internal safe inset.
- `SAFE_VISIBLE_REGION`: the centered image region inside the media box after `--cbs-catalog-safe-inset`; product pixels must remain inside the scaled contain area.
- `OBJECT_FIT_POLICY`: `contain`; no crop, distortion, or source replacement.
- `DESKTOP_MEDIA_SCALE`: `82%` of the safe media box.
- `TABLET_MEDIA_SCALE`: `82%` of the safe media box.
- `MOBILE_MEDIA_SCALE`: `82%` of the safe media box.
- Studio Store aligns its own canvas with the viewport start and reserves the measured persistent-header offset inside the section. This preserves a complete Hero viewport while keeping Store content clear of the header.
- Category size no longer changes card width: every group uses the same responsive card and media geometry for the active layout breakpoint.
- Catalog cards intentionally expose only the product image, title, and `View options` action; product description, current price, variants, availability, and cart action remain inside the product-options interface.

## CBS-COMMERCE-02 — Storefront Cart foundation

- Stage 10C-R2.1 uses a strangler migration: the Buy Button remains the customer-visible cart authority while the replacement Cart API foundation is tested in isolation.
- `STOREFRONT_API_VERSION`: `2026-10`, pinned in the versioned GraphQL endpoint.
- `STOREFRONT_CLIENT_STRATEGY`: a CBS-owned, dependency-free `fetch` transport against Shopify's official Storefront GraphQL endpoint. The official client package is not introduced because this site serves native browser modules without an application bundler.
- `AUTHENTICATION_STRATEGY`: the existing public Storefront access token is sent through `X-Shopify-Storefront-Access-Token`. Public Storefront tokens are browser-safe; no Admin, private Storefront, payment, or fulfillment credential is present.
- `storefront-operations.js` owns all GraphQL documents. UI modules do not contain raw operations.
- `storefront-client.js` owns transport, GraphQL response handling, mutation payload checks, and CBS error categories.
- `cart.js` exposes `getCart`, `ensureCart`, `addLines`, `updateLines`, `removeLines`, `getCheckoutUrl`, and `clearCartReference` without exposing raw transport concerns.
- The cart reference uses the versioned `cbs.commerce.cart.v1` local-storage namespace. Missing, malformed, unavailable, or expired references are cleared; a subsequent `ensureCart` creates a new cart.
- The full cart ID is treated as sensitive session state: it is stored only in browser storage, never logged, placed in markup, or appended to a shareable URL.
- All cart operations share one lightweight promise queue so rapid mutations execute deterministically.
- Stage 10C-R2.1 does not import the new cart manager from the public catalog and performs no customer-visible cutover.
- The isolated live capability proof created one test cart, added three distinct available variants of `CBS Signature Frame` in one `cartLinesAdd` mutation with quantities `2 + 1 + 2`, and received `totalQuantity: 5` with no warnings.
- The same isolated cart passed retrieval, line update, line removal, and HTTPS checkout URL retrieval. No checkout was opened, no payment was attempted, and all remaining test lines were removed afterward.

## Stage 10C-R2.2 — CBS Cart functional integration

- `cart-ui.js` owns the complete CBS cart drawer controller: open/close, rendering, line updates, line removal, subtotal, total-quantity badge, loading/error/empty states, focus management, and explicit checkout handoff.
- The drawer is a controlled local QA surface only. It initializes when the host is `localhost` or `127.0.0.1` and the URL contains `?cbs-cart-qa=1`; normal public navigation receives no CBS Cart launcher or drawer.
- Product and option values are rendered with DOM APIs and `textContent`; remote strings are never interpolated into HTML.
- Quantity controls apply each variant's minimum, maximum, and increment rule before calling the serialized cart manager. Shopify remains authoritative for final validation.
- Cart counts use `cart.totalQuantity`, not the number of cart lines.
- Checkout navigation occurs only after the customer activates `Secure Checkout`; automated QA must not activate that navigation.
- The existing Buy Button module, modal, cart toggle, and checkout remain untouched and authoritative during this substage.

## Stage 10C-R2.3 — Generic product variant composer

- `product-options.js` is the normalized boundary between raw Storefront product metadata and customer-facing configuration UI. It paginates real variants, normalizes selected options, availability, prices, and quantity rules, and classifies products without product-specific branching.
- `variant-composer.js` renders one quantity control for a simple effective variant or one independent row per real Shopify variant for multi-variant products. It never manufactures option combinations.
- Multi-variant composer quantities start at zero as the local “not selected” state. The first increase selects the Shopify minimum; subsequent changes follow the real increment and maximum.
- One composer submission produces one `addLines(lines)` call containing only selected variants. The existing cart manager remains responsible for one-cart persistence and serialized mutations.
- Duplicate submissions share the active promise and cannot create a second add mutation. Controls remain locked through the cart refresh.
- After a successful add, multi-variant selections reset to zero and simple-product quantity resets to its minimum. Failed submissions preserve the current selections.
- The CBS Cart refreshes from Cart API state and opens with the mutation result represented through its normal renderer, including total badge, quantities, selected options, and prices.
- The composer uses DOM creation and `textContent` for Storefront strings. Variant and cart identifiers remain internal and are not placed in visible copy, URLs, or diagnostic logs.
- The composer is initialized only on `localhost` or `127.0.0.1` with `?cbs-cart-qa=1`. Public traffic continues to mount the existing Shopify Buy Button product modal and cart without a composer cutover.
