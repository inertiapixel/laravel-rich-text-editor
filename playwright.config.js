import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the editor engine. Pages are rendered by the real
 * Blade component (tests/browser/render.php) and served from a routed
 * fake origin, so no web server is needed.
 */
export default defineConfig({
    testDir: 'tests/browser',
    timeout: 30000,
    fullyParallel: true,
    reporter: [['list']],
    use: {
        trace: 'off',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ],
});
