/**
 * InertiaPixel Rich Text Editor entry point.
 *
 * The bundle is a strict-mode IIFE. The only global it creates is
 * window.InertiaPixelRichTextEditor. Loading the script twice is harmless:
 * the second copy reuses the first one's API.
 */

import { convert, toTree } from './convert.js';
import { Editor } from './editor.js';
import { countVisibleCharacters, createPolicy, extractText, serializeHtml } from './serializer.js';

const VERSION = '1.0.0';
const SELECTOR = '[data-ipx-rte]';
const GLOBAL = 'InertiaPixelRichTextEditor';

function createApi(win) {
    const doc = win.document;
    const editors = new Map();
    let observer = null;
    let listening = false;

    const readConfig = (root) => {
        try {
            return JSON.parse(root.getAttribute('data-ipx-rte-config') || '{}');
        } catch (error) {
            console.error('InertiaPixel Rich Text Editor: invalid data-ipx-rte-config JSON.', error);

            return null;
        }
    };

    const onSelectionChange = () => {
        for (const editor of editors.values()) {
            editor.onSelectionChange();
        }
    };

    const listen = () => {
        if (listening) {
            return;
        }

        listening = true;
        doc.addEventListener('selectionchange', onSelectionChange);
    };

    const create = (root, overrides) => {
        if (editors.has(root)) {
            return editors.get(root);
        }

        const config = readConfig(root);

        if (!config) {
            return null;
        }

        const editor = new Editor(root, { ...config, ...(overrides || {}) }, {
            onDestroy: (instance) => {
                editors.delete(instance.root);
            },
        });

        // Register before mounting so a re-entrant init cannot double-mount.
        editors.set(root, editor);

        try {
            editor.mount();
        } catch (error) {
            editors.delete(root);
            console.error('InertiaPixel Rich Text Editor: failed to initialize.', error);

            return null;
        }

        listen();

        return editor;
    };

    const resolve = (target) => {
        if (typeof target === 'string') {
            const element = doc.querySelector(target) || doc.getElementById(target);

            return element ? element.closest(SELECTOR) || element.querySelector(SELECTOR) || element : null;
        }

        if (target && target.nodeType === 1) {
            return target.matches(SELECTOR) ? target : target.closest(SELECTOR) || (target.id && doc.getElementById(`${target.id}-editor`));
        }

        return null;
    };

    const api = {
        version: VERSION,

        /** Initialize every editor inside `scope` (default: document). */
        init(scope = doc, overrides = undefined) {
            const roots = [];

            if (scope.nodeType === 1 && scope.matches(SELECTOR)) {
                roots.push(scope);
            }

            roots.push(...scope.querySelectorAll(SELECTOR));

            return roots.map((root) => create(root, overrides)).filter(Boolean);
        },

        /** The editor for a root element, its field, or a selector. */
        get(target) {
            const root = resolve(target);

            return root ? editors.get(root) || null : null;
        },

        destroy(target) {
            const editor = api.get(target);

            if (editor) {
                editor.destroy();
            }
        },

        instances() {
            return Array.from(editors.values());
        },

        /**
         * Pure helpers (no editor needed). `config` uses the client config
         * shape; `options.pretty` (default true) formats HTML output.
         */
        utils: {
            markdownToHtml(markdown, config = {}, options = {}) {
                return serializeHtml(toTree('markdown', markdown, createPolicy(config)).root, options);
            },
            htmlToMarkdown(html, config = {}) {
                return convert('html', 'markdown', html, createPolicy(config)).value;
            },
            sanitizeHtml(html, config = {}, options = {}) {
                return serializeHtml(toTree('html', html, createPolicy(config), { mapStyles: !!options.mapStyles }).root, options);
            },
            extractText(html, config = {}) {
                return extractText(toTree('html', html, createPolicy(config)).root);
            },
            countCharacters(html, config = {}) {
                return countVisibleCharacters(toTree('html', html, createPolicy(config)).root);
            },
            convert(from, to, value, config = {}, options = {}) {
                return convert(from, to, value, createPolicy(config), options);
            },
        },
    };

    const observe = () => {
        if (observer || typeof MutationObserver !== 'function' || !doc.body) {
            return;
        }

        // Pick up editors added later (Livewire, Turbo, dynamic forms) and
        // clean up editors whose markup was removed.
        observer = new MutationObserver((mutations) => {
            let added = false;
            let removed = false;

            for (const mutation of mutations) {
                // Ignore edits inside editors (typing, formatting).
                if (mutation.target.nodeType === 1 && mutation.target.closest('.ipx-rte__body')) {
                    continue;
                }

                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1 && (node.matches(SELECTOR) || node.querySelector(SELECTOR))) {
                        added = true;
                    }
                }

                if (mutation.removedNodes.length) {
                    removed = true;
                }
            }

            if (added) {
                api.init(doc);
            }

            if (removed) {
                for (const [root, editor] of editors) {
                    if (!root.isConnected) {
                        editor.destroy();
                    }
                }
            }
        });

        observer.observe(doc.body, { childList: true, subtree: true });
    };

    const start = () => {
        api.init(doc);
        observe();
    };

    if (doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }

    return api;
}

if (typeof window !== 'undefined') {
    const existing = window[GLOBAL];

    if (existing && typeof existing.init === 'function') {
        existing.init();
    } else {
        Object.defineProperty(window, GLOBAL, {
            value: createApi(window),
            writable: false,
            configurable: false,
            enumerable: false,
        });
    }
}
