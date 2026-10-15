import { expect, test } from '@playwright/test';
import { fieldValue, openEditor, surface } from './helpers.js';

test('renders and edits', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

    await openEditor(page, 'name="content" :value="$v"', { data: { v: '<p>Hello <strong>world</strong></p>' } });
    await expect(surface(page)).toContainText('Hello world');
    await surface(page).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' again');
    expect(await fieldValue(page)).toBe('<p>Hello <strong>world again</strong></p>');
    expect(errors).toEqual([]);
});
