/**
 * End-to-end test against a real Laravel application created by
 * tests/integration/create-app.sh. Skipped unless IPX_APP_URL is set:
 *
 *   IPX_APP_URL=http://127.0.0.1:8765 npx playwright test tests/browser/integration.spec.js
 */
import { expect, test } from '@playwright/test';

const APP = process.env.IPX_APP_URL;

test.skip(!APP, 'Set IPX_APP_URL to run the Laravel integration test.');

test('a fresh Laravel app renders the editor, validates on the server and saves through a normal form', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') {
            errors.push(message.text());
        }
    });

    const assets = [];
    page.on('response', (response) => {
        if (response.url().includes('/inertiapixel/rich-text-editor/assets/')) {
            assets.push({ url: response.url(), status: response.status(), cache: response.headers()['cache-control'] });
        }
    });

    await page.goto(`${APP}/posts/create`);

    const editor = page.locator('.ipx-rte--ready');
    const surface = page.locator('.ipx-rte__surface');

    await expect(editor).toHaveCount(1);
    await expect(surface).toHaveAccessibleName('Content');
    await expect(page.locator('.ipx-rte__counter')).toHaveText('0 / 500 characters (minimum 10)');
    // Route-served assets are versioned and cached forever; published
    // assets are plain static files served by the web server.
    if (!process.env.IPX_PUBLISHED_ASSETS) {
        expect(assets.map((asset) => asset.status)).toEqual([200, 200]);
        expect(assets.every((asset) => asset.cache.includes('immutable'))).toBe(true);
    }

    // Client-side validation stops a too-short submission.
    await surface.click();
    await page.keyboard.type('Short');
    await page.locator('#save').click();
    await expect(page.locator('.ipx-rte__client-error')).toHaveText('Enter at least 10 characters (5 more).');

    // Bypass the browser checks: Laravel validates, redirects back with
    // the error and the old input.
    await page.locator('#save-unchecked').click();
    await page.waitForURL(`${APP}/posts/create`);
    await expect(page.locator('.ipx-rte__error')).toHaveText('The content field must contain at least 10 characters.');
    await expect(surface).toHaveText('Short');
    await expect(surface).toHaveAttribute('aria-invalid', 'true');

    // Switch to Markdown, write a valid post and save it.
    await page.locator('.ipx-rte__mode[data-mode="markdown"]').click();
    await page.locator('.ipx-rte__source').fill('## Hello Laravel\n\nThis is **saved** through a <script>alert(1)</script> normal form.');
    await page.locator('#save').click();
    await page.waitForURL(`${APP}/posts/show`);

    const post = page.locator('#post .ipx-rte-content');
    await expect(post.locator('h2')).toHaveText('Hello Laravel');
    await expect(post.locator('strong')).toHaveText('saved');
    await expect(post).toContainText('<script>alert(1)</script>');
    await expect(post.locator('script')).toHaveCount(0);

    expect(errors).toEqual([]);
});
