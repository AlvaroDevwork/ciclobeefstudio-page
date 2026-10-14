const { defineConfig } = require("@playwright/test");

const chromiumUse = {
    browserName: "chromium",
    // Playwright 1.64 does not ship a macOS 12 Chromium build. The installed
    // Chrome channel is Chromium and remains controllable by Playwright.
    channel: "chrome",
};

module.exports = defineConfig({
    testDir: "./tests/e2e",
    outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || "/tmp/cbs-stage10-playwright",
    timeout: 120_000,
    expect: {
        timeout: 10_000,
    },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [["line"]],
    use: {
        baseURL: "http://127.0.0.1:8000",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "off",
    },
    projects: [
        {
            name: "desktop-chromium",
            use: { ...chromiumUse, viewport: { width: 1280, height: 800 } },
        },
        {
            name: "tablet-ipad-chromium",
            use: { ...chromiumUse, viewport: { width: 820, height: 1180 } },
        },
        {
            name: "mobile-iphone-chromium",
            use: { ...chromiumUse, viewport: { width: 375, height: 812 } },
        },
    ],
    webServer: {
        command: ".venv/bin/python -m mkdocs serve --dev-addr 127.0.0.1:8000",
        url: "http://127.0.0.1:8000/?cbs-cart-qa=1",
        reuseExistingServer: true,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
    },
});
