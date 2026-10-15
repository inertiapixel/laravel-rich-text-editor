import { expect, test } from '@playwright/test';
import { fieldValue, open, openEditor, page as wrap, render, surface, toolbarButton } from './helpers.js';

test.describe('JavaScript isolation', () => {
    test('defines exactly one global and loading twice is harmless', async ({ page }) => {
        const component = render('<x-inertiapixel::rich-text-editor name="content" />');
        await open(page, wrap(`<script>window.__ipxBefore = Object.getOwnPropertyNames(window);</script><form>${component}</form>`));

        const added = await page.evaluate(() => Object.getOwnPropertyNames(window).filter((name) => !window.__ipxBefore.includes(name) && name !== '__ipxBefore'));
        expect(added).toEqual(['InertiaPixelRichTextEditor']);

        await page.addScriptTag({ url: '/inertiapixel/rich-text-editor/assets/editor.js' });
        await page.evaluate(() => window.InertiaPixelRichTextEditor.init());

        await expect(page.locator('.ipx-rte__toolbar')).toHaveCount(1);
        expect(await page.evaluate(() => window.InertiaPixelRichTextEditor.instances().length)).toBe(1);
    });

    test('assets are emitted once per page for many editors', async () => {
        const html = render('<x-inertiapixel::rich-text-editor name="a" /><x-inertiapixel::rich-text-editor name="b" /><x-inertiapixel::rich-text-editor name="a" />');

        expect(html.match(/data-ipx-rte-asset="editor-js"/g)).toHaveLength(1);
        expect(html.match(/data-ipx-rte-asset="editor-css"/g)).toHaveLength(1);
        expect(html).toContain('id="ipx-rte-a"');
        expect(html).toContain('id="ipx-rte-b"');
        expect(html).toContain('id="ipx-rte-a-2"');
    });

    test('multiple editors keep separate content, history and selection', async ({ page }) => {
        const html = wrap(`<form method="post" action="/submit">${render('<x-inertiapixel::rich-text-editor name="first" /><x-inertiapixel::rich-text-editor name="second" />')}</form>`);
        await open(page, html);

        await surface(page, 0).click();
        await page.keyboard.type('one');
        await surface(page, 1).click();
        await page.keyboard.type('two');
        await toolbarButton(page, 'undo', 1).click();

        expect(await fieldValue(page, 'first')).toBe('<p>one</p>');
        expect(await fieldValue(page, 'second')).toBe('');
        await expect(toolbarButton(page, 'redo', 0)).toBeDisabled();
        await expect(toolbarButton(page, 'redo', 1)).toBeEnabled();
    });

    test('editors added later are initialized and removed editors are destroyed', async ({ page }) => {
        const component = render('<x-inertiapixel::rich-text-editor name="late" />');
        await open(page, wrap('<div id="host"></div><script src="/inertiapixel/rich-text-editor/assets/editor.js"></script>'));

        await page.evaluate((markup) => {
            const template = document.createElement('template');
            template.innerHTML = markup;
            document.getElementById('host').append(template.content);
        }, component.replace(/<link[^>]*>|<script[^>]*><\/script>/g, ''));

        await expect(page.locator('.ipx-rte--ready')).toHaveCount(1);
        expect(await page.evaluate(() => window.InertiaPixelRichTextEditor.instances().length)).toBe(1);

        await page.evaluate(() => document.getElementById('host').replaceChildren());
        await expect.poll(() => page.evaluate(() => window.InertiaPixelRichTextEditor.instances().length)).toBe(0);
    });

    test('destroy removes the UI, dialogs and listeners and restores the field', async ({ page }) => {
        await openEditor(page, 'name="content" required :value="$v"', { data: { v: '<p>x</p>' } });
        await toolbarButton(page, 'link').click();
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.InertiaPixelRichTextEditor.destroy('#ipx-rte-content'));

        await expect(page.locator('.ipx-rte__toolbar')).toHaveCount(0);
        await expect(page.locator('dialog.ipx-rte-dialog')).toHaveCount(0);
        await expect(page.locator('textarea[name="content"]')).toBeVisible();
        await expect(page.locator('textarea[name="content"]')).toHaveAttribute('required', '');
        await expect(page.locator('textarea[name="content"]')).toHaveValue('<p>x</p>');
    });

    test('public instance API', async ({ page }) => {
        await openEditor(page, 'name="content" :options="[\'markdown\' => true]"');

        const result = await page.evaluate(async () => {
            const editor = window.InertiaPixelRichTextEditor.get('#ipx-rte-content');
            const events = [];
            editor.root.addEventListener('ipx-rte:change', (event) => events.push(event.detail.format));
            editor.setValue('<p>Set <em>by</em> API</p>', 'html');
            const html = editor.getValue();
            await editor.setMode('markdown');

            return { html, markdown: editor.getValue(), format: editor.getFormat(), mode: editor.getMode(), count: editor.getCharacterCount(), events };
        });

        expect(result).toEqual({ html: '<p>Set <em>by</em> API</p>', markdown: 'Set *by* API', format: 'markdown', mode: 'markdown', count: 12, events: ['html', 'markdown'] });
    });

    test('works without JavaScript as a plain textarea', async ({ browser }) => {
        const context = await browser.newContext({ javaScriptEnabled: false });
        const page = await context.newPage();
        const html = wrap(`<form>${render('<x-inertiapixel::rich-text-editor name="content" :value="$v" />', { data: { v: '<p>raw</p>' } })}</form>`);

        await page.route('http://ipx.test/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
        await page.goto('http://ipx.test/');

        await expect(page.locator('textarea[name="content"]')).toBeVisible();
        await expect(page.locator('textarea[name="content"]')).toHaveValue('<p>raw</p>');
        await context.close();
    });
});

test.describe('Accessibility', () => {
    test('labels, roles and descriptions', async ({ page }) => {
        await openEditor(page, 'name="content" :max-chars="10"', { before: '<label for="ipx-rte-content">Article body</label>' });

        await expect(surface(page)).toHaveAttribute('role', 'textbox');
        await expect(surface(page)).toHaveAttribute('aria-multiline', 'true');
        await expect(surface(page)).toHaveAccessibleName('Article body');
        await expect(surface(page)).toHaveAccessibleDescription('0 / 10 characters');
        await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();

        await page.getByText('Article body').click();
        await expect(surface(page)).toBeFocused();
    });

    test('aria-label is used without a label', async ({ page }) => {
        await openEditor(page, 'name="content" aria-label="Description"');
        await expect(surface(page)).toHaveAccessibleName('Description');
    });

    test('toolbar uses a roving tabindex with arrow-key navigation', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<p>x</p>' } });
        await surface(page).click();
        await page.keyboard.press('Alt+F10');

        const focused = () => page.evaluate(() => document.activeElement.getAttribute('aria-label') || document.activeElement.textContent);
        expect(await focused()).toBe('Text style');
        await page.keyboard.press('ArrowRight');
        expect(await focused()).toBe('Bold');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        expect(await focused()).toBe('Source');

        const tabbable = await page.locator('.ipx-rte__toolbar [tabindex="0"]').count();
        expect(tabbable).toBe(1);

        await page.keyboard.press('Escape');
        await expect(surface(page)).toBeFocused();
    });

    test('toggle buttons expose aria-pressed and shortcuts', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<p><strong>b</strong></p>' } });
        await page.locator('.ipx-rte__surface strong').click();

        await expect(toolbarButton(page, 'bold')).toHaveAttribute('aria-pressed', 'true');
        await expect(toolbarButton(page, 'italic')).toHaveAttribute('aria-pressed', 'false');
        await expect(toolbarButton(page, 'bold')).toHaveAttribute('aria-keyshortcuts', /^(Meta|Control)\+B$/);
    });

    test('dialogs are labelled modals that return focus', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<p>x</p>' } });
        await surface(page).click();
        await toolbarButton(page, 'table').click();

        const modal = page.getByRole('dialog', { name: 'Insert table' });
        await expect(modal).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(modal).toBeHidden();
        await expect(surface(page)).toBeFocused();
    });

    test('server validation errors and old input are restored after a failed submission', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v" :options="[\'markdown\' => true]"', {
            data: { v: '<p>stored value</p>' },
            old: { content: '**old** markdown', content_format: 'markdown' },
            errors: { content: ['The content must be at least 100 characters.'] },
        });

        const error = page.locator('.ipx-rte__error');
        const source = page.locator('.ipx-rte__source');

        await expect(error).toHaveText('The content must be at least 100 characters.');
        await expect(page.locator('.ipx-rte')).toHaveClass(/ipx-rte--invalid/);
        await expect(source).toHaveValue('**old** markdown');
        await expect(source).toHaveAttribute('aria-invalid', 'true');
        await expect(source).toHaveAccessibleDescription('The content must be at least 100 characters.');
        expect(await fieldValue(page)).toBe('**old** markdown');
    });
});
