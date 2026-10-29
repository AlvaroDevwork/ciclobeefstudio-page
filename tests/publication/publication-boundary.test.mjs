import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { findForbiddenPublicationFiles } from "../../scripts/validate-publication-boundary.mjs";

async function fixture(files) {
    const root = await mkdtemp(path.join(os.tmpdir(), "cbs-publication-boundary-"));
    for (const filename of files) {
        const absolutePath = path.join(root, filename);
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, "fixture", "utf8");
    }
    return root;
}

test("allows customer pages and required commerce assets", async t => {
    const root = await fixture([
        "index.html",
        "cart/index.html",
        "privacy/index.html",
        "terms/index.html",
        "assets/css/cart-return.css",
        "assets/js/commerce/shopify-buy.js",
    ]);
    t.after(() => rm(root, { recursive: true, force: true }));

    assert.deepEqual(await findForbiddenPublicationFiles(root), []);
});

test("rejects internal documentation and repository artifacts", async t => {
    const root = await fixture([
        "ai-log/execution/index.html",
        "audits/release/deepseek-audit-prompt/index.html",
        "business/ciclobeef-basic-landing-value-proposition/index.html",
        "technical/production-idempotency-guard/index.html",
        "tests/cart.test.mjs",
        ".env.production",
    ]);
    t.after(() => rm(root, { recursive: true, force: true }));

    assert.deepEqual(await findForbiddenPublicationFiles(root), [
        ".env.production",
        "ai-log/execution/index.html",
        "audits/release/deepseek-audit-prompt/index.html",
        "business/ciclobeef-basic-landing-value-proposition/index.html",
        "technical/production-idempotency-guard/index.html",
        "tests/cart.test.mjs",
    ]);
});
