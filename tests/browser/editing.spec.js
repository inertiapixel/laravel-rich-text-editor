import { expect, test } from '@playwright/test';
import { caretAtEnd, fieldValue, openEditor, paste, selectText, surface, toolbarButton } from './helpers.js';

const MOD = 'ControlOrMeta';

test.describe('Typing and blocks', () => {
    test('typing into an empty editor creates a paragraph', async ({ page }) => {
        await openEditor(page);
        await surface(page).click();
        await page.keyboard.type('Hello');

        expect(await fieldValue(page)).toBe('<p>Hello</p>');
    });

    test('Enter splits paragraphs and Shift+Enter inserts a line break', async ({ page }) => {
        await openEditor(page);
        await surface(page).click();
        await page.keyboard.type('One');
        await page.keyboard.press('Enter');
        await page.keyboard.type('Two');
        await page.keyboard.press('Shift+Enter');
        await page.keyboard.type('Three');

        expect(await fieldValue(page)).toBe('<p>One</p><p>Two<br>Three</p>');
    });

    test('headings from the block menu; Enter after a heading starts a paragraph', async ({ page }) => {
        await openEditor(page);
        await surface(page).click();
        await page.keyboard.type('Title');
        await page.locator('.ipx-rte__select').selectOption('h2');
        await surface(page).focus();
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await page.keyboard.type('Body');

        expect(await fieldValue(page)).toBe('<h2>Title</h2><p>Body</p>');
    });

    test('bullet lists: Enter continues, Tab nests, Enter on an empty item leaves the list', async ({ page }) => {
        await openEditor(page);
        await surface(page).click();
        await page.keyboard.type('a');
        await toolbarButton(page, 'bullet_list').click();
        await page.keyboard.press('Enter');
        await page.keyboard.type('b');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.type('c');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await page.keyboard.type('after');

        expect(await fieldValue(page)).toBe('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul><p>after</p>');
        await expect(toolbarButton(page, 'bullet_list')).toHaveAttribute('aria-pressed', 'false');
    });

    test('switching list type and removing a list', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<ul><li>a</li><li>b</li></ul>' } });
        await selectText(page, 'ab'.slice(0, 1));
        await page.keyboard.press(`${MOD}+a`);
        await toolbarButton(page, 'ordered_list').click();
        expect(await fieldValue(page)).toBe('<ol><li>a</li><li>b</li></ol>');

        await toolbarButton(page, 'ordered_list').click();
        expect(await fieldValue(page)).toBe('<p>a</p><p>b</p>');
    });

    test('Backspace at the start of a list item turns it into a paragraph', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<ul><li>a</li><li>b</li></ul>' } });
        await selectText(page, 'b');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('Backspace');

        expect(await fieldValue(page)).toBe('<ul><li>a</li></ul><p>b</p>');
    });

    test('blockquotes toggle and Enter on an empty line leaves the quote', async ({ page }) => {
        await openEditor(page);
        await surface(page).click();
        await page.keyboard.type('Quote');
        await toolbarButton(page, 'blockquote').click();
        await expect(toolbarButton(page, 'blockquote')).toHaveAttribute('aria-pressed', 'true');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await page.keyboard.type('Outside');

        expect(await fieldValue(page)).toBe('<blockquote><p>Quote</p></blockquote><p>Outside</p>');
    });

    test('code blocks keep newlines and are left with two Enters', async ({ page }) => {
        await openEditor(page);
        await surface(page).click();
        await page.keyboard.type('let a = 1;');
        await toolbarButton(page, 'code_block').click();
        await page.keyboard.press('Enter');
        await page.keyboard.type('  let b = <b>;');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await page.keyboard.type('text');

        expect(await fieldValue(page)).toBe('<pre><code>let a = 1;\n  let b = &lt;b&gt;;</code></pre><p>text</p>');
    });

    test('horizontal rule inserts a paragraph after it', async ({ page }) => {
        await openEditor(page);
        await surface(page).click();
        await page.keyboard.type('Above');
        await toolbarButton(page, 'horizontal_rule').click();
        await page.keyboard.type('Below');

        expect(await fieldValue(page)).toBe('<p>Above</p><hr><p>Below</p>');
    });

    test('alignment and indentation are classes, never styles', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<p>Text</p>' } });
        await selectText(page, 'Text');
        await toolbarButton(page, 'align_center').click();
        await toolbarButton(page, 'indent').click();
        await toolbarButton(page, 'indent').click();

        expect(await fieldValue(page)).toBe('<p class="ipx-rte-text-center ipx-rte-indent-2">Text</p>');
        await expect(toolbarButton(page, 'align_center')).toHaveAttribute('aria-pressed', 'true');

        await toolbarButton(page, 'align_center').click();
        await toolbarButton(page, 'outdent').click();
        expect(await fieldValue(page)).toBe('<p class="ipx-rte-indent-1">Text</p>');
    });
});

test.describe('Inline formatting', () => {
    test('toolbar toggles marks on the selection', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<p>Hello world</p>' } });
        await selectText(page, 'Hello');
        await toolbarButton(page, 'bold').click();
        await expect(toolbarButton(page, 'bold')).toHaveAttribute('aria-pressed', 'true');
        await toolbarButton(page, 'italic').click();
        expect(await fieldValue(page)).toBe('<p><strong><em>Hello</em></strong> world</p>');

        await toolbarButton(page, 'bold').click();
        expect(await fieldValue(page)).toBe('<p><em>Hello</em> world</p>');
    });

    test('partial unbold splits the mark', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<p><strong>abcdef</strong></p>' } });
        await selectText(page, 'cd');
        await toolbarButton(page, 'bold').click();

        expect(await fieldValue(page)).toBe('<p><strong>ab</strong>cd<strong>ef</strong></p>');
    });

    test('marks across paragraphs', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<p>one two</p><p>three</p>' } });
        await page.evaluate(() => {
            const paragraphs = document.querySelectorAll('.ipx-rte__surface p');
            const range = document.createRange();
            range.setStart(paragraphs[0].firstChild, 4);
            range.setEnd(paragraphs[1].firstChild, 3);
            paragraphs[0].closest('[contenteditable]').focus();
            document.getSelection().removeAllRanges();
            document.getSelection().addRange(range);
        });
        await toolbarButton(page, 'underline').click();
        await toolbarButton(page, 'strikethrough').click();

        expect(await fieldValue(page)).toBe('<p>one <u><s>two</s></u></p><p><u><s>thr</s></u>ee</p>');
    });

    test('keyboard shortcuts toggle pending marks for the next typed text', async ({ page }) => {
        await openEditor(page);
        await surface(page).click();
        await page.keyboard.type('a ');
        await page.keyboard.press(`${MOD}+b`);
        await page.keyboard.type('bold');
        await page.keyboard.press(`${MOD}+b`);
        await page.keyboard.type(' c ');
        await page.keyboard.press(`${MOD}+e`);
        await page.keyboard.type('code');

        expect(await fieldValue(page)).toBe('<p>a <strong>bold</strong> c <code>code</code></p>');
    });

    test('clear formatting removes marks and block classes', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<p class="ipx-rte-text-right"><strong>a</strong> <em>b</em> <a href="/x">c</a></p>' } });
        await page.keyboard.press(`${MOD}+a`).catch(() => {});
        await selectText(page, 'a b c');
        await toolbarButton(page, 'clear_formatting').click();

        expect(await fieldValue(page)).toBe('<p>a b <a href="/x">c</a></p>');
    });
});

test.describe('Undo and redo', () => {
    test('toolbar and keyboard undo/redo restore content and selection', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<p>Hello</p>' } });
        await selectText(page, 'Hello');
        await toolbarButton(page, 'bold').click();
        expect(await fieldValue(page)).toBe('<p><strong>Hello</strong></p>');

        await toolbarButton(page, 'undo').click();
        expect(await fieldValue(page)).toBe('<p>Hello</p>');

        await page.keyboard.press(`${MOD}+Shift+z`);
        expect(await fieldValue(page)).toBe('<p><strong>Hello</strong></p>');

        await page.keyboard.press(`${MOD}+z`);
        expect(await fieldValue(page)).toBe('<p>Hello</p>');
        await expect(toolbarButton(page, 'undo')).toBeDisabled();
        await expect(toolbarButton(page, 'redo')).toBeEnabled();
    });

    test('typing is grouped into one undo step', async ({ page }) => {
        await openEditor(page);
        await surface(page).click();
        await page.keyboard.type('quick typing');
        await page.keyboard.press(`${MOD}+z`);

        expect(await fieldValue(page)).toBe('');
    });
});

test.describe('Paste', () => {
    test('pasted HTML is normalized and unsafe markup removed', async ({ page }) => {
        await openEditor(page);
        await surface(page).click();
        await paste(page, {
            html: '<meta charset="utf-8"><h1 style="color:red">Title</h1><p class="MsoNormal" onclick="alert(1)">Body <span style="font-weight:bold">bold</span><script>window.__ipxPasted = 1</script></p><img src="x" onerror="window.__ipxPasted = 2"><a href="javascript:alert(1)">bad link</a>',
            text: 'Title Body bold bad link',
        });

        expect(await fieldValue(page)).toBe('<h1>Title</h1><p>Body <strong>bold</strong></p><p><img src="x" alt="">bad link</p>');
        expect(await page.evaluate(() => window.__ipxPasted)).toBeUndefined();
    });

    test('plain text paste keeps paragraphs and line breaks as text', async ({ page }) => {
        await openEditor(page);
        await surface(page).click();
        await paste(page, { text: 'one <b>\ntwo\n\nthree' });

        expect(await fieldValue(page)).toBe('<p>one &lt;b&gt;<br>two</p><p>three</p>');
    });

    test('inline paste stays in the current paragraph', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<p>ac</p>' } });
        await selectText(page, 'a');
        await page.keyboard.press('ArrowRight');
        await paste(page, { html: '<b>B</b>', text: 'B' });

        expect(await fieldValue(page)).toBe('<p>a<strong>B</strong>c</p>');
    });

    test('pasting into a code block inserts plain text', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<pre><code>x</code></pre>' } });
        await caretAtEnd(page, '.ipx-rte__surface code');
        await paste(page, { html: '<p><strong>y</strong></p><p>z</p>', text: 'y\n\nz' });

        expect(await fieldValue(page)).toBe('<pre><code>xy\nz</code></pre>');
    });

    test('Mod+Shift+V pastes plain text', async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'Shortcut-driven paste flags are verified once.');
        await openEditor(page);
        await surface(page).click();
        await page.keyboard.down(MOD === 'ControlOrMeta' ? (process.platform === 'darwin' ? 'Meta' : 'Control') : MOD);
        await page.keyboard.down('Shift');
        await page.keyboard.press('v');
        await page.keyboard.up('Shift');
        await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
        await paste(page, { html: '<h2>Big</h2>', text: 'Big' });

        expect(await fieldValue(page)).toBe('<p>Big</p>');
    });
});
