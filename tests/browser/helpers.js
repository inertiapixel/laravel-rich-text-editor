import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const ASSETS = {
    'editor.js': ['resources/dist/inertiapixel-rich-text-editor.js', 'application/javascript'],
    'editor.css': ['resources/dist/inertiapixel-rich-text-editor.css', 'text/css'],
    'content.css': ['resources/dist/inertiapixel-rich-text-content.css', 'text/css'],
};

/** Render Blade through Laravel (Testbench) and return the HTML. */
export function render(blade, { config = {}, data = {}, old, errors } = {}) {
    return execFileSync('php', [path.join(root, 'tests/browser/render.php')], {
        input: JSON.stringify({ blade, config, data, old, errors }),
        cwd: root,
    }).toString();
}

export function page(body, { head = '' } = {}) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="csrf-token" content="test-csrf-token"><title>Test</title>${head}</head><body>${body}</body></html>`;
}

/**
 * Serve `html` at http://ipx.test/ with package assets, a mock upload
 * endpoint and a form-submission recorder.
 */
export async function open(browserPage, html, { upload } = {}) {
    const submissions = [];
    const uploads = [];

    await browserPage.route('http://ipx.test/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());

        if (url.pathname === '/') {
            return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
        }

        const asset = /^\/inertiapixel\/rich-text-editor\/assets\/(.+)$/.exec(url.pathname);

        if (asset && ASSETS[asset[1]]) {
            const [file, type] = ASSETS[asset[1]];

            return route.fulfill({ contentType: type, body: readFileSync(path.join(root, file)) });
        }

        if (url.pathname === '/upload') {
            uploads.push({ headers: request.headers(), body: request.postDataBuffer() });

            if (upload) {
                return upload(route, request);
            }

            return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ url: '/storage/uploaded.png', name: 'uploaded.png', size: 10, mime: 'image/png', type: 'image' }) });
        }

        if (url.pathname === '/submit') {
            submissions.push(new URLSearchParams(request.postData() || ''));

            return route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><p id="submitted">ok</p>' });
        }

        return route.fulfill({ status: 404, body: 'not found' });
    });

    await browserPage.goto('http://ipx.test/');
    await browserPage.waitForFunction(() => window.InertiaPixelRichTextEditor && document.querySelectorAll('[data-ipx-rte]').length === document.querySelectorAll('.ipx-rte--ready').length);

    return { submissions, uploads };
}

/** Render a component inside a POST form and open it. */
export async function openEditor(browserPage, attributes = 'name="content"', { config, data, old, errors, upload, before = '', after = '' } = {}) {
    const component = render(`<x-inertiapixel::rich-text-editor ${attributes} />`, { config, data, old, errors });
    const html = page(`<form method="post" action="/submit">${before}${component}${after}<button type="submit" id="save">Save</button></form>`);

    return open(browserPage, html, { upload });
}

export async function fieldValue(browserPage, name = 'content') {
    return browserPage.evaluate((field) => {
        const editor = window.InertiaPixelRichTextEditor.instances().find((instance) => instance.field.name === field);
        editor.sync();

        return editor.field.value;
    }, name);
}

export const surface = (browserPage, index = 0) => browserPage.locator('.ipx-rte__surface').nth(index);

export const toolbarButton = (browserPage, command, index = 0) => browserPage.locator('.ipx-rte').nth(index).locator(`.ipx-rte__toolbar [data-command="${command}"]`);

export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Select `text` inside an editor surface (by DOM ranges, like a user drag). */
export async function selectText(browserPage, text, { index = 0, occurrence = 0 } = {}) {
    await browserPage.evaluate(([needle, editorIndex, nth]) => {
        const root = document.querySelectorAll('.ipx-rte__surface')[editorIndex];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let full = '';
        const nodes = [];
        let node = walker.nextNode();

        while (node) {
            nodes.push({ node, start: full.length });
            full += node.data;
            node = walker.nextNode();
        }

        let position = -1;

        for (let i = 0; i <= nth; i += 1) {
            position = full.indexOf(needle, position + 1);
        }

        if (position === -1) {
            throw new Error(`Text not found: ${needle}`);
        }

        const locate = (offset, preferEnd) => {
            for (const entry of nodes) {
                const end = entry.start + entry.node.data.length;

                if (offset < end || (preferEnd && offset === end)) {
                    return [entry.node, offset - entry.start];
                }
            }

            const last = nodes[nodes.length - 1];

            return [last.node, last.node.data.length];
        };

        root.focus();
        const range = document.createRange();
        range.setStart(...locate(position, false));
        range.setEnd(...locate(position + needle.length, true));
        const selection = document.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }, [text, index, occurrence]);
}

/** Put the caret at the end of the text of the n-th element matching selector. */
export async function caretAtEnd(browserPage, selector, index = 0) {
    await browserPage.evaluate(([css, nth]) => {
        const element = document.querySelectorAll(css)[nth];
        element.closest('[contenteditable]').focus();
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        document.getSelection().removeAllRanges();
        document.getSelection().addRange(range);
    }, [selector, index]);
}

export async function paste(browserPage, { html, text }, index = 0) {
    await browserPage.evaluate(([htmlData, textData, editorIndex]) => {
        const target = document.querySelectorAll('.ipx-rte__surface')[editorIndex];
        const data = new DataTransfer();

        if (htmlData !== null) {
            data.setData('text/html', htmlData);
        }

        if (textData !== null) {
            data.setData('text/plain', textData);
        }

        const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });

        if (event.clipboardData && event.clipboardData.types.length) {
            target.dispatchEvent(event);
            return;
        }

        // Firefox ignores clipboardData on synthetic events; call the
        // editor's paste handler with an equivalent event instead.
        const editor = window.InertiaPixelRichTextEditor.instances().find((instance) => instance.surface === target);
        editor.onPaste({ preventDefault() {}, clipboardData: data });
    }, [html ?? null, text ?? null, index]);
}

export const value = fieldValue;
