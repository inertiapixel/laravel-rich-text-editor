import { expect, test } from '@playwright/test';
import { caretAtEnd, fieldValue, openEditor, selectText, surface, toolbarButton } from './helpers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64').toString('base64');

test('Backspace merging a heading into a paragraph leaves no spans or styles', async ({ page }) => {
    await openEditor(page, 'name="content" :value="$v"', { data: { v: '<p>First <strong>bold</strong></p><h2>Second</h2>' } });
    await selectText(page, 'Second');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Backspace');

    const value = await fieldValue(page);
    expect(value).toMatch(/^<p>First <strong>bold<\/strong>\s?Second<\/p>$/);
    expect(await surface(page).innerHTML()).not.toMatch(/style=|<span|<font/);
});

test('select all and delete leaves an empty paragraph that still accepts typing', async ({ page }) => {
    await openEditor(page, 'name="content" :value="$v"', { data: { v: '<h2>a</h2><ul><li>b</li></ul><p>c</p>' } });
    await surface(page).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('new');

    expect(await fieldValue(page)).toMatch(/^<(p|h2)>new<\/(p|h2)>$/);
});

test('optional word count', async ({ page }) => {
    await openEditor(page, 'name="content" :value="$v" :options="[\'counter\' => [\'show\' => true, \'words\' => true]]"', { data: { v: '<p>three little words</p>' } });

    await expect(page.locator('.ipx-rte__counter')).toHaveText('18 characters · 3 words');
});

test('the field dispatches input events for frameworks such as Alpine and Livewire', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
        window.__ipxInputs = [];
        document.querySelector('textarea[name="content"]').addEventListener('input', (event) => window.__ipxInputs.push(event.target.value));
    });
    await surface(page).click();
    await page.keyboard.type('hi');

    await expect.poll(() => page.evaluate(() => window.__ipxInputs.at(-1))).toBe('<p>hi</p>');
});

test('images can be displayed as blocks', async ({ page }) => {
    await openEditor(page);
    await surface(page).click();
    await toolbarButton(page, 'image').click();

    const modal = page.locator('dialog.ipx-rte-dialog[open]');
    await modal.getByLabel('From URL').check();
    await modal.getByLabel('Image URL').fill('/a.png');
    await modal.getByLabel('Alternative text', { exact: true }).fill('A');
    await modal.getByLabel('Display').selectOption('block');
    await modal.getByRole('button', { name: 'Insert' }).click();

    expect(await fieldValue(page)).toBe('<p><img src="/a.png" alt="A" class="ipx-rte-img--block"></p>');
});

test('pasting an image file opens the image dialog with the file selected', async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', 'Firefox does not expose files on synthetic clipboard events.');
    await openEditor(page, 'name="content" upload-url="/upload"');
    await surface(page).click();
    await page.evaluate((png) => {
        const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
        const data = new DataTransfer();
        data.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
        document.querySelector('.ipx-rte__surface').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, PNG);

    const modal = page.locator('dialog.ipx-rte-dialog[open]');
    await expect(modal.getByRole('heading')).toHaveText('Insert image');
    await expect(modal.getByLabel('Alternative text', { exact: true })).toBeFocused();
    await modal.getByLabel('Alternative text', { exact: true }).fill('Pasted');
    await modal.getByRole('button', { name: 'Insert' }).click();
    await expect(modal).toBeHidden();

    expect(await fieldValue(page)).toBe('<p><img src="/storage/uploaded.png" alt="Pasted"></p>');
});

test('dropped HTML is sanitized', async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', 'Firefox ignores dataTransfer on synthetic drop events.');
    await openEditor(page, 'name="content" :value="$v"', { data: { v: '<p>target</p>' } });
    await caretAtEnd(page, '.ipx-rte__surface p');

    await page.evaluate(() => {
        const target = document.querySelector('.ipx-rte__surface p');
        const box = target.getBoundingClientRect();
        const data = new DataTransfer();
        data.setData('text/html', '<p style="color:red">dropped <em onclick="x">text</em><script>window.__ipxDropped=1</script></p>');
        data.setData('text/plain', 'dropped text');
        target.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientX: box.right - 1, clientY: box.top + box.height / 2 }));
    });

    expect(await fieldValue(page)).toBe('<p>targetdropped <em>text</em></p>');
    expect(await page.evaluate(() => window.__ipxDropped)).toBeUndefined();
});

test('dark theme applies to the editor and its dialogs', async ({ page }) => {
    await openEditor(page, 'name="content" :options="[\'theme\' => \'dark\']"');
    await toolbarButton(page, 'table').click();

    const colors = await page.evaluate(() => ({
        editor: getComputedStyle(document.querySelector('.ipx-rte')).backgroundColor,
        dialog: getComputedStyle(document.querySelector('dialog.ipx-rte-dialog')).backgroundColor,
    }));

    expect(colors).toEqual({ editor: 'rgb(17, 24, 39)', dialog: 'rgb(17, 24, 39)' });
});

test('the toolbar wraps without horizontal scrolling on small screens', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openEditor(page, 'name="content" :options="[\'markdown\' => true]"');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});
