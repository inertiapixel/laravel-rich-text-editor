import { expect, test } from '@playwright/test';
import { fieldValue, openEditor, paste, render, page as wrap, open, selectText, surface, toolbarButton } from './helpers.js';

const counter = (page, index = 0) => page.locator('.ipx-rte__counter').nth(index);

test.describe('Counter visibility', () => {
    test('hidden without limits', async ({ page }) => {
        await openEditor(page);
        await expect(counter(page)).toBeHidden();
    });

    test('shown automatically with only a minimum', async ({ page }) => {
        await openEditor(page, 'name="content" :min-chars="10"');
        await expect(counter(page)).toHaveText('0 characters (minimum 10)');
        await expect(counter(page)).toHaveClass(/ipx-rte__counter--under/);
    });

    test('shown automatically with only a maximum', async ({ page }) => {
        await openEditor(page, 'name="content" :max-chars="20"');
        await expect(counter(page)).toHaveText('0 / 20 characters');
    });

    test('show-counter overrides automatic display both ways', async ({ page }) => {
        await openEditor(page, 'name="content" :max-chars="20" :show-counter="false"');
        await expect(counter(page)).toBeHidden();

        await openEditor(page, 'name="content" show-counter');
        await expect(counter(page)).toHaveText('0 characters');
    });

    test('limits from config apply and attributes override them', async ({ page }) => {
        await openEditor(page, 'name="content" :max-chars="50"', { config: { 'richtext.limits.min_chars': 5, 'richtext.limits.max_chars': 100 } });
        await expect(counter(page)).toHaveText('0 / 50 characters (minimum 5)');
    });

    test('zero is a real limit', async ({ page }) => {
        await openEditor(page, 'name="content" :max-chars="0"');
        await expect(counter(page)).toHaveText('0 / 0 characters');
        await expect(counter(page)).toHaveClass(/ipx-rte__counter--at-max/);

        await surface(page).click();
        await page.keyboard.type('x');
        await expect(counter(page)).toHaveClass(/ipx-rte__counter--over/);
    });
});

test.describe('Counting', () => {
    test('counts visible characters, not markup, in rich text', async ({ page }) => {
        await openEditor(page, 'name="content" :max-chars="100" :value="$v"', { data: { v: '<p><a href="https://example.com/very/long">Link</a> <strong>bold</strong></p><p>x</p>' } });
        await expect(counter(page)).toHaveText('10 / 100 characters');

        await selectText(page, 'x');
        await toolbarButton(page, 'italic').click();
        await expect(counter(page)).toHaveText('10 / 100 characters');
    });

    test('updates after typing, deletion, paste, undo and redo', async ({ page }) => {
        await openEditor(page, 'name="content" :max-chars="100"');
        await surface(page).click();
        await page.keyboard.type('hello');
        await expect(counter(page)).toHaveText('5 / 100 characters');

        await page.keyboard.press('Backspace');
        await expect(counter(page)).toHaveText('4 / 100 characters');

        await paste(page, { text: ' pasted' });
        await expect(counter(page)).toHaveText('11 / 100 characters');

        await page.keyboard.press('ControlOrMeta+z');
        await expect(counter(page)).toHaveText('4 / 100 characters');

        await page.keyboard.press('ControlOrMeta+Shift+z');
        await expect(counter(page)).toHaveText('11 / 100 characters');
    });

    test('counts emoji as Unicode code points', async ({ page }) => {
        await openEditor(page, 'name="content" :max-chars="10" :value="$v"', { data: { v: '<p>👍 é 👨‍👩‍👧</p>' } });

        // 👍 (1) + space + é (1) + space + family emoji (5 code points)
        await expect(counter(page)).toHaveText('9 / 10 characters');
    });

    test('Markdown and plain text count their source; switching modes updates the count', async ({ page }) => {
        await openEditor(page, 'name="content" :max-chars="100" :value="$v" :options="[\'markdown\' => true, \'plainText\' => true]"', { data: { v: '<p><strong>bold</strong></p>' } });
        await expect(counter(page)).toHaveText('4 / 100 characters');

        await page.locator('.ipx-rte__mode[data-mode="markdown"]').click();
        await expect(counter(page)).toHaveText('8 / 100 characters');

        await page.locator('.ipx-rte__source').fill('line one\nline two');
        await expect(counter(page)).toHaveText('17 / 100 characters');
    });

    test('source view of HTML counts the visible text it would save', async ({ page }) => {
        await openEditor(page, 'name="content" :max-chars="100" :value="$v"', { data: { v: '<p>abc</p>' } });
        await page.locator('.ipx-rte__mode[data-mode="code"]').click();
        await page.locator('.ipx-rte__source').fill('<p><strong>abcd</strong></p>');

        await expect(counter(page)).toHaveText('4 / 100 characters');
    });

    test('multiple editors keep separate limits and counts', async ({ page }) => {
        const html = wrap(`<form method="post" action="/submit">${render('<x-inertiapixel::rich-text-editor name="title" :max-chars="5" /><x-inertiapixel::rich-text-editor name="body" :min-chars="3" />')}</form>`);
        await open(page, html);

        await surface(page, 0).click();
        await page.keyboard.type('abc');
        await surface(page, 1).click();
        await page.keyboard.type('x');

        await expect(counter(page, 0)).toHaveText('3 / 5 characters');
        await expect(counter(page, 1)).toHaveText('1 character (minimum 3)');
    });
});

test.describe('Limit enforcement', () => {
    test('does not block or truncate by default', async ({ page }) => {
        await openEditor(page, 'name="content" :max-chars="3"');
        await surface(page).click();
        await page.keyboard.type('abcdef');

        expect(await fieldValue(page)).toBe('<p>abcdef</p>');
        await expect(counter(page)).toHaveClass(/ipx-rte__counter--over/);
    });

    test('hard enforcement stops typing and oversize pastes', async ({ page }) => {
        await openEditor(page, 'name="content" :max-chars="5" :options="[\'limits\' => [\'enforce_max\' => true]]"');
        await surface(page).click();
        await page.keyboard.type('abcdefgh');
        expect(await fieldValue(page)).toBe('<p>abcde</p>');

        await page.keyboard.press('Backspace');
        await paste(page, { text: 'too long' });
        expect(await fieldValue(page)).toBe('<p>abcd</p>');

        await paste(page, { text: 'z' });
        expect(await fieldValue(page)).toBe('<p>abcdz</p>');
        await expect(page.locator('.ipx-rte [aria-live="polite"]')).not.toBeEmpty();
    });

    test('hard enforcement in plain text mode', async ({ page }) => {
        await openEditor(page, 'name="content" mode="text" :max-chars="3" :options="[\'plainText\' => true, \'limits\' => [\'enforce_max\' => true]]"');
        await page.locator('.ipx-rte__source').click();
        await page.keyboard.type('abcdef');

        expect(await fieldValue(page)).toBe('abc');
    });

    test('announces crossing the maximum', async ({ page }) => {
        await openEditor(page, 'name="content" :max-chars="3"');
        await surface(page).click();
        await page.keyboard.type('abcd');

        await expect(page.locator('.ipx-rte [aria-live="polite"]')).toHaveText('The maximum of 3 characters is exceeded by 1.');
    });
});

test.describe('Form submission and validation', () => {
    test('submits the content and format fields through an ordinary form', async ({ page }) => {
        const { submissions } = await openEditor(page, 'name="content" :value="$v"', { data: { v: '<p>Saved</p>' } });
        await surface(page).click();
        await page.keyboard.press('End');
        await page.keyboard.type('!');
        await page.locator('#save').click();
        await expect(page.locator('#submitted')).toBeVisible();

        expect(submissions).toHaveLength(1);
        expect(submissions[0].get('content')).toBe('<p>Saved!</p>');
        expect(submissions[0].get('content_format')).toBe('html');
    });

    test('bracketed field names keep their name and a matching format field', async ({ page }) => {
        const { submissions } = await openEditor(page, 'name="post[body]" :value="$v"', { data: { v: '<p>x</p>' } });
        await page.locator('#save').click();
        await expect(page.locator('#submitted')).toBeVisible();

        expect(submissions[0].get('post[body]')).toBe('<p>x</p>');
        expect(submissions[0].get('post[body_format]')).toBe('html');
    });

    test('blocks submission below the minimum and explains why', async ({ page }) => {
        const { submissions } = await openEditor(page, 'name="content" :min-chars="10" :max-chars="20"');
        await surface(page).click();
        await page.keyboard.type('short');
        await page.locator('#save').click();

        const error = page.locator('.ipx-rte__client-error');
        await expect(error).toHaveText('Enter at least 10 characters (5 more).');
        await expect(surface(page)).toHaveAttribute('aria-invalid', 'true');
        await expect(surface(page)).toBeFocused();
        expect((await surface(page).getAttribute('aria-describedby')).split(' ')).toContain(await error.getAttribute('id'));
        expect(submissions).toHaveLength(0);

        await page.keyboard.type(' enough');
        await expect(error).toBeHidden();
        await page.locator('#save').click();
        await expect(page.locator('#submitted')).toBeVisible();
        expect(submissions[0].get('content')).toBe('<p>short enough</p>');
    });

    test('blocks submission above the maximum', async ({ page }) => {
        const { submissions } = await openEditor(page, 'name="content" :max-chars="3" :value="$v"', { data: { v: '<p>abcd</p>' } });
        await page.locator('#save').click();

        await expect(page.locator('.ipx-rte__client-error')).toHaveText('The maximum of 3 characters is exceeded by 1.');
        expect(submissions).toHaveLength(0);
    });

    test('an empty optional field skips the minimum, a required one does not', async ({ page }) => {
        let result = await openEditor(page, 'name="content" :min-chars="5"');
        await page.locator('#save').click();
        await expect(page.locator('#submitted')).toBeVisible();
        expect(result.submissions[0].get('content')).toBe('');

        result = await openEditor(page, 'name="content" required');
        await page.locator('#save').click();
        await expect(page.locator('.ipx-rte__client-error')).toHaveText('This field is required.');
        await expect(surface(page)).toHaveAttribute('aria-required', 'true');
        expect(result.submissions).toHaveLength(0);
    });

    test('validate_on_submit can be disabled and formnovalidate is respected', async ({ page }) => {
        let result = await openEditor(page, 'name="content" :min-chars="5" :value="$v" :options="[\'limits\' => [\'validate_on_submit\' => false]]"', { data: { v: '<p>ab</p>' } });
        await page.locator('#save').click();
        await expect(page.locator('#submitted')).toBeVisible();
        expect(result.submissions).toHaveLength(1);

        result = await openEditor(page, 'name="content" :min-chars="5" :value="$v"', { data: { v: '<p>ab</p>' }, after: '<button type="submit" formnovalidate id="draft">Draft</button>' });
        await page.locator('#draft').click();
        await expect(page.locator('#submitted')).toBeVisible();
        expect(result.submissions).toHaveLength(1);
    });

    test('form reset restores the initial content', async ({ page }) => {
        await openEditor(page, 'name="content" :value="$v"', { data: { v: '<p>Initial</p>' }, after: '<button type="reset" id="reset">Reset</button>' });
        await surface(page).click();
        await page.keyboard.type(' changed');
        await page.locator('#reset').click();

        await expect(surface(page)).toHaveText('Initial');
        expect(await fieldValue(page)).toBe('<p>Initial</p>');
    });

    test('disabled editors are not editable and not submitted', async ({ page }) => {
        const { submissions } = await openEditor(page, 'name="content" disabled :value="$v"', { data: { v: '<p>x</p>' } });
        await expect(surface(page)).toHaveAttribute('contenteditable', 'false');
        await expect(toolbarButton(page, 'bold')).toBeDisabled();
        await page.locator('#save').click();
        await expect(page.locator('#submitted')).toBeVisible();

        expect(submissions[0].has('content')).toBe(false);
    });

    test('readonly editors submit but cannot be changed', async ({ page }) => {
        const { submissions } = await openEditor(page, 'name="content" readonly :value="$v"', { data: { v: '<p>x</p>' } });
        await expect(surface(page)).toHaveAttribute('contenteditable', 'false');
        await expect(surface(page)).toHaveAttribute('aria-readonly', 'true');
        await expect(page.locator('.ipx-rte__mode').first()).toBeDisabled();
        await page.locator('#save').click();
        await expect(page.locator('#submitted')).toBeVisible();

        expect(submissions[0].get('content')).toBe('<p>x</p>');
    });
});
