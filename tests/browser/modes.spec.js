import { expect, test } from '@playwright/test';
import { fieldValue, openEditor, selectText, surface, toolbarButton } from './helpers.js';

const ALL_MODES = 'name="content" :value="$v" :options="[\'markdown\' => true, \'plainText\' => true, \'codeView\' => true]"';

const modeButton = (page, label) => page.locator('.ipx-rte__modes').getByRole('button', { name: label, exact: true });
const source = (page) => page.locator('.ipx-rte__source');
const confirmDialog = (page) => page.locator('dialog.ipx-rte-dialog[open]');
const formatValue = (page) => page.locator('input[name="content_format"]').inputValue();

test.describe('Mode switcher', () => {
    test('shows only enabled modes', async ({ page }) => {
        await openEditor(page, 'name="content" :options="[\'codeView\' => false]"');
        await expect(page.locator('.ipx-rte__modes')).toHaveCount(0);

        await openEditor(page, 'name="content" :options="[\'markdown\' => true]"');
        await expect(page.locator('.ipx-rte__mode[data-mode]')).toHaveText(['Rich text', 'Markdown', 'Source']);
    });

    test('source view shows and edits the HTML without converting it', async ({ page }) => {
        await openEditor(page, ALL_MODES, { data: { v: '<p>Hello <strong>world</strong></p><ul><li>a</li></ul>' } });
        await modeButton(page, 'Source').click();

        await expect(source(page)).toHaveValue('<p>Hello <strong>world</strong></p>\n<ul>\n  <li>a</li>\n</ul>');
        expect(await formatValue(page)).toBe('html');

        await source(page).fill('<h2>Edited</h2><p>in <em>source</em></p>');
        expect(await fieldValue(page)).toBe('<h2>Edited</h2><p>in <em>source</em></p>');

        await modeButton(page, 'Rich text').click();
        await expect(confirmDialog(page)).toHaveCount(0);
        await expect(surface(page).locator('h2')).toHaveText('Edited');
        expect(await fieldValue(page)).toBe('<h2>Edited</h2><p>in <em>source</em></p>');
    });

    test('warns before removing unsupported markup typed in source view', async ({ page }) => {
        await openEditor(page, ALL_MODES, { data: { v: '<p>x</p>' } });
        await modeButton(page, 'Source').click();
        await source(page).fill('<p style="color:red">Safe</p><script>window.__ipxSource = 1</script>');

        await expect(page.locator('.ipx-rte__notice')).toContainText('Unsupported markup is removed when saved: <script>, style=""');
        expect(await fieldValue(page)).toBe('<p>Safe</p>');

        await modeButton(page, 'Rich text').click();
        await expect(confirmDialog(page)).toContainText('<script>');
        await confirmDialog(page).getByRole('button', { name: 'Cancel' }).click();
        await expect(source(page)).toBeVisible();
        await expect(source(page)).toHaveValue('<p style="color:red">Safe</p><script>window.__ipxSource = 1</script>');

        await modeButton(page, 'Rich text').click();
        await confirmDialog(page).getByRole('button', { name: 'Switch anyway' }).click();
        await expect(surface(page)).toHaveText('Safe');
        expect(await page.evaluate(() => window.__ipxSource)).toBeUndefined();
    });

    test('rich text to Markdown is lossless for supported content and keeps the field name', async ({ page }) => {
        await openEditor(page, ALL_MODES, { data: { v: '<h2>Title</h2><p>Some <strong>bold</strong> and <a href="/x">link</a></p><ul><li>one</li></ul>' } });
        await modeButton(page, 'Markdown').click();

        await expect(confirmDialog(page)).toHaveCount(0);
        await expect(source(page)).toHaveValue('## Title\n\nSome **bold** and [link](/x)\n\n- one');
        expect(await fieldValue(page)).toBe('## Title\n\nSome **bold** and [link](/x)\n\n- one');
        expect(await formatValue(page)).toBe('markdown');
        await expect(page.locator('textarea[name="content"]')).toHaveCount(1);
    });

    test('lossy conversion asks first; cancelling keeps everything', async ({ page }) => {
        const original = '<p class="ipx-rte-text-center"><u>Under</u> text</p>';
        await openEditor(page, ALL_MODES, { data: { v: original } });
        await modeButton(page, 'Markdown').click();

        const modal = confirmDialog(page);
        await expect(modal).toContainText('Switching to Markdown cannot keep everything');
        await expect(modal).toContainText('Underlined text');
        await expect(modal).toContainText('Text alignment');
        await modal.getByRole('button', { name: 'Cancel' }).click();

        await expect(surface(page)).toBeVisible();
        expect(await fieldValue(page)).toBe(original);
        expect(await formatValue(page)).toBe('html');
    });

    test('switching back without edits restores the original exactly', async ({ page }) => {
        const markdown = '* item one\n* item two\n\n__strong__ and _em_\n\nTitle\n=====';
        await openEditor(page, `${ALL_MODES} mode="markdown"`, { data: { v: markdown } });
        await expect(source(page)).toHaveValue(markdown);

        await modeButton(page, 'Rich text').click();
        await expect(surface(page).locator('h1')).toHaveText('Title');
        await modeButton(page, 'Markdown').click();

        await expect(source(page)).toHaveValue(markdown);
    });

    test('undo reverts a mode switch', async ({ page }) => {
        await openEditor(page, ALL_MODES, { data: { v: '<p>a <u>b</u></p>' } });
        await modeButton(page, 'Plain text').click();
        await confirmDialog(page).getByRole('button', { name: 'Switch anyway' }).click();
        await expect(source(page)).toHaveValue('a b');
        expect(await formatValue(page)).toBe('text');

        await toolbarButton(page, 'undo').click();
        await expect(surface(page)).toBeVisible();
        expect(await fieldValue(page)).toBe('<p>a <u>b</u></p>');
        expect(await formatValue(page)).toBe('html');
    });

    test('plain text is stored as text and never becomes markup', async ({ page }) => {
        await openEditor(page, `${ALL_MODES} mode="text"`, { data: { v: '' } });
        await source(page).fill('Line <b>one</b>\nLine two\n\nNext paragraph');

        expect(await fieldValue(page)).toBe('Line <b>one</b>\nLine two\n\nNext paragraph');
        expect(await formatValue(page)).toBe('text');

        await modeButton(page, 'Rich text').click();
        await expect(confirmDialog(page)).toHaveCount(0);
        expect(await fieldValue(page)).toBe('<p>Line &lt;b&gt;one&lt;/b&gt;<br>Line two</p><p>Next paragraph</p>');
    });

    test('Markdown preview renders sanitized output', async ({ page }) => {
        await openEditor(page, `${ALL_MODES} mode="markdown"`, { data: { v: '# Hi\n\n<img src=x onerror="window.__ipxPreview=1">\n\n[bad](javascript:alert(1))' } });
        await modeButton(page, 'Preview').click();

        const preview = page.locator('.ipx-rte__preview');
        await expect(preview.locator('h1')).toHaveText('Hi');
        await expect(preview).toContainText('<img src=x onerror="window.__ipxPreview=1">');
        await expect(preview.locator('a')).toHaveCount(0);
        await expect(toolbarButton(page, 'bold')).toBeDisabled();
        expect(await page.evaluate(() => window.__ipxPreview)).toBeUndefined();

        await modeButton(page, 'Write').click();
        await expect(source(page)).toBeVisible();
    });

    test('toolbar edits Markdown source in Markdown mode', async ({ page }) => {
        await openEditor(page, `${ALL_MODES} mode="markdown"`, { data: { v: 'word' } });
        await source(page).focus();
        await page.keyboard.press('ControlOrMeta+a');
        await toolbarButton(page, 'bold').click();
        await expect(source(page)).toHaveValue('**word**');

        await page.locator('.ipx-rte__select').selectOption('h2');
        await expect(source(page)).toHaveValue('## **word**');

        await toolbarButton(page, 'bullet_list').click();
        await expect(source(page)).toHaveValue('- **word**');
        await expect(toolbarButton(page, 'underline')).toBeDisabled();
        await expect(toolbarButton(page, 'align_center')).toBeDisabled();

        await toolbarButton(page, 'undo').click();
        await expect(source(page)).toHaveValue('## **word**');
    });

    test('code view of Markdown keeps Markdown', async ({ page }) => {
        await openEditor(page, `${ALL_MODES} mode="markdown"`, { data: { v: '**x**' } });
        await modeButton(page, 'Source').click();

        await expect(source(page)).toHaveValue('**x**');
        expect(await formatValue(page)).toBe('markdown');
        await modeButton(page, 'Markdown').click();
        await expect(source(page)).toHaveValue('**x**');
    });

    test('a stored format whose mode is enabled is loaded without conversion', async ({ page }) => {
        await openEditor(page, `${ALL_MODES} format="markdown"`, { data: { v: '*kept*' } });

        await expect(modeButton(page, 'Markdown')).toHaveAttribute('aria-pressed', 'true');
        expect(await fieldValue(page)).toBe('*kept*');
    });

    test('mode-change events fire', async ({ page }) => {
        await openEditor(page, ALL_MODES, { data: { v: '<p>a</p>' } });
        await page.evaluate(() => {
            window.__ipxModes = [];
            document.querySelector('.ipx-rte').addEventListener('ipx-rte:mode-change', (event) => window.__ipxModes.push(`${event.detail.mode}:${event.detail.format}`));
        });
        await modeButton(page, 'Markdown').click();
        await modeButton(page, 'Source').click();

        expect(await page.evaluate(() => window.__ipxModes)).toEqual(['markdown:markdown', 'code:markdown']);
    });

    test('selection in rich mode is kept when toolbar buttons are clicked', async ({ page }) => {
        await openEditor(page, ALL_MODES, { data: { v: '<p>keep this selected</p>' } });
        await selectText(page, 'this');
        await toolbarButton(page, 'italic').click();
        await toolbarButton(page, 'bold').click();

        expect(await page.evaluate(() => document.getSelection().toString())).toBe('this');
        expect(await fieldValue(page)).toBe('<p>keep <em><strong>this</strong></em> selected</p>');
    });
});
