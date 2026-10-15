import { expect, test } from '@playwright/test';
import { caretAtEnd, fieldValue, openEditor, selectText, surface, toolbarButton } from './helpers.js';

// 1x1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const dialog = (page) => page.locator('dialog.ipx-rte-dialog[open]');

test.describe('Link dialog', () => {
    test('adds, edits and removes a link while keeping the selection', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<p>Visit our site today</p>' } });
        await selectText(page, 'our site');
        await toolbarButton(page, 'link').click();

        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page).getByLabel('URL')).toBeFocused();
        await dialog(page).getByLabel('URL').fill('example.com/about');
        await dialog(page).getByLabel('Open in a new tab').check();
        await page.keyboard.press('Enter');

        await expect(dialog(page)).toBeHidden();
        expect(await fieldValue(page)).toBe('<p>Visit <a href="https://example.com/about" target="_blank" rel="noopener noreferrer">our site</a> today</p>');

        await selectText(page, 'site');
        await page.keyboard.press('ControlOrMeta+k');
        await expect(dialog(page).getByLabel('URL')).toHaveValue('https://example.com/about');
        await dialog(page).getByLabel('URL').fill('/contact');
        await dialog(page).getByLabel('Open in a new tab').uncheck();
        await dialog(page).getByRole('button', { name: 'Update' }).click();
        expect(await fieldValue(page)).toBe('<p>Visit <a href="/contact">our site</a> today</p>');

        await selectText(page, 'site');
        await toolbarButton(page, 'unlink').click();
        expect(await fieldValue(page)).toBe('<p>Visit our site today</p>');
    });

    test('rejects dangerous URLs', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<p>x</p>' } });
        await selectText(page, 'x');
        await toolbarButton(page, 'link').click();
        await dialog(page).getByLabel('URL').fill('javascript:alert(1)');
        await dialog(page).getByRole('button', { name: 'Insert' }).click();

        await expect(dialog(page).getByText('Enter a valid URL')).toBeVisible();
        await expect(dialog(page).getByLabel('URL')).toHaveAttribute('aria-invalid', 'true');

        await page.keyboard.press('Escape');
        await expect(dialog(page)).toBeHidden();
        expect(await fieldValue(page)).toBe('<p>x</p>');
    });

    test('inserts a new link with text at a collapsed caret', async ({ page }) => {
        await openEditor(page);
        await surface(page).click();
        await page.keyboard.type('See ');
        await toolbarButton(page, 'link').click();
        await dialog(page).getByLabel('URL').fill('mailto:team@example.com');
        await dialog(page).getByLabel('Text').fill('the team');
        await page.keyboard.press('Enter');

        expect(await fieldValue(page)).toBe('<p>See <a href="mailto:team@example.com">the team</a></p>');
    });
});

test.describe('Image dialog', () => {
    test('inserts an image by URL with alt text, size, alignment and style classes', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<p>Before</p>' } });
        await caretAtEnd(page, '.ipx-rte__surface p');
        await toolbarButton(page, 'image').click();

        const modal = dialog(page);
        await expect(modal.getByText('Uploads are not available')).toBeHidden();
        await modal.getByLabel('From URL').check();
        await modal.getByLabel('Image URL').fill('https://cdn.example.com/cat.png');
        await modal.getByRole('button', { name: 'Insert' }).click();
        await expect(modal.getByText('Enter alternative text or mark the image as decorative.')).toBeVisible();

        await modal.getByLabel('Alternative text', { exact: true }).fill('A sleeping cat');
        await modal.getByLabel('Width (%)').selectOption('50');
        await modal.getByLabel('Alignment').selectOption('center');
        await modal.getByLabel('Rounded corners').check();
        await modal.getByRole('button', { name: 'Insert' }).click();
        await expect(modal).toBeHidden();

        const value = await fieldValue(page);
        expect(value).toBe('<p>Before<img src="https://cdn.example.com/cat.png" alt="A sleeping cat" class="ipx-rte-img--rounded ipx-rte-w-50 ipx-rte-img-center"></p>');
        expect(value).not.toContain('style=');
    });

    test('pixel sizes become width/height attributes and captions make a figure', async ({ page }) => {
        await openEditor(page, 'name="content" :options="$o"', { data: { o: { images: { allow_height: true } } } });
        await surface(page).click();
        await toolbarButton(page, 'image').click();

        const modal = dialog(page);
        await modal.getByLabel('From URL').check();
        await modal.getByLabel('Image URL').fill('/img/chart.png');
        await modal.getByLabel('Decorative image').check();
        await modal.locator('.ipx-rte-dialog__row').first().getByLabel('Unit').selectOption('px');
        await modal.getByLabel('Width (px)').fill('320');
        await modal.locator('.ipx-rte-dialog__row').nth(1).getByLabel('Unit').selectOption('px');
        await modal.getByLabel('Height (px)').fill('9999');
        await modal.getByLabel('Caption').fill('Quarterly <results>');
        await modal.getByRole('button', { name: 'Insert' }).click();
        await expect(modal.getByText('Enter a whole number between 1 and 4000.')).toBeVisible();

        await modal.getByLabel('Height (px)').fill('200');
        await modal.getByRole('button', { name: 'Insert' }).click();
        await expect(modal).toBeHidden();

        expect(await fieldValue(page)).toBe('<figure class="ipx-rte-figure"><img src="/img/chart.png" alt="" width="320" height="200"><figcaption>Quarterly &lt;results&gt;</figcaption></figure>');
    });

    test('uploads an image through the configured endpoint', async ({ page }) => {
        const { uploads } = await openEditor(page, 'name="content" upload-url="/upload"');
        await surface(page).click();
        await toolbarButton(page, 'image').click();

        const modal = dialog(page);
        await modal.getByLabel('Image file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
        await expect(modal.locator('.ipx-rte-dialog__preview')).toBeVisible();
        await modal.getByLabel('Alternative text', { exact: true }).fill('Photo');
        await modal.getByRole('button', { name: 'Insert' }).click();
        await expect(modal).toBeHidden();

        expect(await fieldValue(page)).toBe('<p><img src="/storage/uploaded.png" alt="Photo"></p>');
        expect(uploads).toHaveLength(1);
        expect(uploads[0].headers['x-csrf-token']).toBe('test-csrf-token');
        expect(uploads[0].headers.accept).toBe('application/json');

        const body = uploads[0].body.toString('latin1');
        expect(body).toContain('name="file"; filename="photo.png"');
        expect(body).toContain('name="type"');
    });

    test('rejects disallowed and oversized files before uploading', async ({ page }) => {
        const { uploads } = await openEditor(page, 'name="content" upload-url="/upload" :options="$o"', { data: { o: { images: { max_size: 0.00001 } } } });
        await surface(page).click();
        await toolbarButton(page, 'image').click();

        const modal = dialog(page);
        await modal.getByLabel('Image file').setInputFiles({ name: 'evil.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg onload="alert(1)"/>') });
        await expect(modal.getByText('This file type is not allowed.')).toBeVisible();

        await modal.getByLabel('Image file').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(2048) });
        await expect(modal.getByText(/The file is larger than/)).toBeVisible();
        expect(uploads).toHaveLength(0);
    });

    test('shows server validation errors and invalid responses', async ({ page }) => {
        let attempt = 0;
        await openEditor(page, 'name="content" upload-url="/upload"', {
            upload: (route) => {
                attempt += 1;

                if (attempt === 1) {
                    return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ message: 'Invalid.', errors: { file: ['The file must be an image.'] } }) });
                }

                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'javascript:alert(1)' }) });
            },
        });
        await surface(page).click();
        await toolbarButton(page, 'image').click();

        const modal = dialog(page);
        await modal.getByLabel('Image file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
        await modal.getByLabel('Alternative text', { exact: true }).fill('x');
        await modal.getByRole('button', { name: 'Insert' }).click();
        await expect(modal.getByRole('alert').filter({ hasText: 'The file must be an image.' })).toBeVisible();

        await modal.getByRole('button', { name: 'Insert' }).click();
        await expect(modal.getByRole('alert').filter({ hasText: 'invalid upload response' })).toBeVisible();
        await modal.getByRole('button', { name: 'Cancel' }).click();

        expect(await fieldValue(page)).toBe('');
    });

    test('explains a missing upload endpoint instead of failing silently', async ({ page }) => {
        await openEditor(page, 'name="content" :options="$o"', { data: { o: { images: { allow_url: false } } } });
        await surface(page).click();
        await toolbarButton(page, 'image').click();

        await expect(dialog(page).getByText('Uploads are not available: no upload URL is configured for this editor.')).toBeVisible();
    });

    test('edits an existing image', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<p><img src="/a.png" alt="Old" class="ipx-rte-w-25"></p>' } });
        await page.locator('.ipx-rte__surface img').dblclick();

        const modal = dialog(page);
        await expect(modal.getByRole('heading')).toHaveText('Edit image');
        await expect(modal.getByLabel('Alternative text', { exact: true })).toHaveValue('Old');
        await expect(modal.getByLabel('Width (%)')).toHaveValue('25');
        await modal.getByLabel('Alternative text', { exact: true }).fill('New');
        await modal.getByLabel('Width (%)').selectOption('100');
        await modal.getByRole('button', { name: 'Update' }).click();

        expect(await fieldValue(page)).toBe('<p><img src="/a.png" alt="New" class="ipx-rte-w-100"></p>');
    });
});

test.describe('File attachments', () => {
    test('inserts a safe attachment link', async ({ page }) => {
        await openEditor(page, 'name="content" upload-url="/upload" :options="$o"', {
            data: { o: { files: true } },
            upload: (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ url: '/storage/report.pdf', name: 'report.pdf', size: 1200, type: 'file' }) }),
        });
        await surface(page).click();
        await toolbarButton(page, 'file').click();

        const modal = dialog(page);
        await modal.getByLabel('File', { exact: true }).setInputFiles({ name: 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
        await expect(modal.getByLabel('Link text')).toHaveValue('report.pdf');
        await modal.getByRole('button', { name: 'Insert' }).click();
        await expect(modal).toBeHidden();

        expect(await fieldValue(page)).toBe('<p><a href="/storage/report.pdf" class="ipx-rte-attachment">report.pdf</a></p>');
    });

    test('blocks executable attachments client-side', async ({ page }) => {
        const { uploads } = await openEditor(page, 'name="content" upload-url="/upload" :options="$o"', { data: { o: { files: true } } });
        await surface(page).click();
        await toolbarButton(page, 'file').click();
        await dialog(page).getByLabel('File', { exact: true }).setInputFiles({ name: 'run.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
        await dialog(page).getByRole('button', { name: 'Insert' }).click();

        await expect(dialog(page).getByText('This file type is not allowed.')).toBeVisible();
        expect(uploads).toHaveLength(0);
    });
});

test.describe('Tables', () => {
    test('inserts a table with a header row and presets', async ({ page }) => {
        await openEditor(page);
        await surface(page).click();
        await toolbarButton(page, 'table').click();

        const modal = dialog(page);
        await modal.getByLabel('Rows').fill('3');
        await modal.getByLabel('Columns').fill('2');
        await expect(modal.getByLabel('Bordered')).toBeChecked();
        await modal.getByLabel('Striped').check();
        await modal.getByRole('button', { name: 'Insert' }).click();
        await page.keyboard.type('H1');
        await page.keyboard.press('Tab');
        await page.keyboard.type('H2');
        await page.keyboard.press('Tab');
        await page.keyboard.type('a');

        expect(await fieldValue(page)).toBe('<table class="ipx-rte-table ipx-rte-table--bordered ipx-rte-table--striped"><thead><tr><th scope="col">H1</th><th scope="col">H2</th></tr></thead><tbody><tr><td>a</td><td></td></tr><tr><td></td><td></td></tr></tbody></table>');
    });

    test('row, column, header and design operations keep a valid table', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<table class="ipx-rte-table"><tbody><tr><td>a</td><td>b</td></tr></tbody></table>' } });
        await caretAtEnd(page, '.ipx-rte__surface td');

        const bar = page.locator('.ipx-rte__tablebar');
        await expect(bar).toBeVisible();
        await bar.getByRole('button', { name: 'Row below' }).click();
        await bar.getByRole('button', { name: 'Column right' }).click();
        expect(await fieldValue(page)).toBe('<table class="ipx-rte-table"><tbody><tr><td>a</td><td></td><td>b</td></tr><tr><td></td><td></td><td></td></tr></tbody></table>');

        await caretAtEnd(page, '.ipx-rte__surface td');
        await bar.getByRole('button', { name: 'Header row' }).click();
        await expect(bar.getByRole('button', { name: 'Header row' })).toHaveAttribute('aria-pressed', 'true');
        await bar.getByRole('button', { name: 'Design' }).click();
        await dialog(page).getByLabel('Compact').check();
        await dialog(page).getByRole('button', { name: 'Apply' }).click();

        await caretAtEnd(page, '.ipx-rte__surface td', 1);
        await bar.getByRole('button', { name: 'Delete column' }).click();
        expect(await fieldValue(page)).toBe('<table class="ipx-rte-table ipx-rte-table--compact"><thead><tr><th scope="col">a</th><th scope="col">b</th></tr></thead><tbody><tr><td></td><td></td></tr></tbody></table>');

        await bar.getByRole('button', { name: 'Delete row' }).click();
        await bar.getByRole('button', { name: 'Delete table' }).click();
        expect(await fieldValue(page)).toBe('');
        await expect(bar).toBeHidden();
    });

    test('Tab in the last cell adds a row', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<table class="ipx-rte-table"><tbody><tr><td>a</td></tr></tbody></table>' } });
        await caretAtEnd(page, '.ipx-rte__surface td');
        await page.keyboard.press('Tab');
        await page.keyboard.type('b');

        expect(await fieldValue(page)).toBe('<table class="ipx-rte-table"><tbody><tr><td>a</td></tr><tr><td>b</td></tr></tbody></table>');
    });

    test('host tables outside the editor are not styled', async ({ page }) => {
        await openEditor(page, 'name="content"', { after: '<table id="host"><tr><td id="host-cell">host</td></tr></table><p id="host-p">p</p><button type="button" id="host-button">b</button>' });

        const styles = await page.evaluate(() => ({
            collapse: getComputedStyle(document.getElementById('host')).borderCollapse,
            padding: getComputedStyle(document.getElementById('host-cell')).paddingLeft,
            margin: getComputedStyle(document.getElementById('host-p')).marginBottom,
            button: getComputedStyle(document.getElementById('host-button')).minWidth,
        }));

        expect(styles.collapse).toBe('separate');
        expect(styles.padding).toBe('1px');
        expect(styles.margin).toBe('16px');
        expect(['auto', '0px']).toContain(styles.button);
    });
});
