/**
 * Conversions between the three stored formats: "html", "markdown" and
 * "text". Every conversion goes through a clean (sanitized) DOM tree, and
 * every conversion is checked for loss by converting the result back and
 * comparing the canonical HTML.
 */

import { BLOCK_TAGS, isElement, isText } from './dom.js';
import { fragmentToMarkdown, markdownLossReasons, markdownToFragment } from './markdown.js';
import { createReport, extractText, importHtml, serializeHtml } from './serializer.js';

export const FORMATS = ['html', 'markdown', 'text'];

export const MODE_FORMAT = { rich: 'html', markdown: 'markdown', text: 'text' };

function container(doc, fragment) {
    const root = doc.createElement('div');
    root.appendChild(fragment);

    return root;
}

/**
 * Parse a stored value into a clean tree.
 */
export function toTree(format, value, policy, options = {}) {
    const doc = options.document || document;
    const report = options.report || createReport();

    if (format === 'markdown') {
        const parsed = markdownToFragment(value, { document: doc, tables: policy.tables });
        const { fragment } = importHtml(container(doc, parsed), policy, { document: doc, report });

        return { root: container(doc, fragment), report };
    }

    if (format === 'text') {
        return { root: container(doc, textToFragment(value, doc)), report };
    }

    const { fragment } = importHtml(String(value), policy, { document: doc, report, mapStyles: !!options.mapStyles });

    return { root: container(doc, fragment), report };
}

/**
 * Serialize a clean tree into a stored format.
 */
export function fromTree(format, root, options = {}) {
    if (format === 'markdown') {
        return fragmentToMarkdown(root);
    }

    if (format === 'text') {
        return treeToText(root);
    }

    return serializeHtml(root, { pretty: options.pretty !== false });
}

/**
 * Canonical form used to compare documents. Empty paragraphs and the
 * difference between spaces and non-breaking spaces are not content.
 */
export function canonical(root) {
    return serializeHtml(root, { pretty: false })
        .replace(/<p><br><\/p>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/ {2,}/g, ' ')
        .replace(/ ?(<br>) ?/g, '$1')
        .replace(/(<(?:p|h[1-6]|li|td|th|figcaption)(?: [^>]*)?>) | (<\/(?:p|h[1-6]|li|td|th|figcaption)>)/g, '$1$2');
}

/**
 * Convert a value between formats and report whether anything was lost.
 *
 * @returns {{ value: string, lossy: boolean, reasons: string[] }}
 */
export function convert(from, to, value, policy, options = {}) {
    const doc = options.document || document;
    const report = createReport();
    const source = toTree(from, value, policy, { document: doc, report });
    const reasons = new Set();

    if (from === to) {
        return { value: fromTree(to, source.root, options), lossy: false, reasons: [] };
    }

    const result = fromTree(to, source.root, options);
    const back = toTree(to, result, policy, { document: doc });
    const lossy = canonical(back.root) !== canonical(source.root);

    if (lossy) {
        if (to === 'markdown') {
            for (const reason of markdownLossReasons(source.root)) {
                reasons.add(reason);
            }
        }

        if (to === 'text') {
            reasons.add('loss_formatting');
        }

        if (!reasons.size) {
            reasons.add('loss_other');
        }
    }

    return { value: result, lossy, reasons: Array.from(reasons) };
}

/**
 * Check what the sanitizer would remove from HTML typed in source view.
 *
 * @returns {{ lossy: boolean, items: string[] }}
 */
export function inspectHtml(value, policy, options = {}) {
    const report = createReport();
    importHtml(String(value), policy, { document: options.document || document, report });

    const items = [
        ...Array.from(report.removedTags).map((tag) => `<${tag}>`),
        ...Array.from(report.removedAttributes).map((name) => `${name}=""`),
        ...Array.from(report.removedClasses).map((name) => `.${name}`),
    ];

    return { lossy: items.length > 0, items };
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

/**
 * Plain text to paragraphs: blank lines separate paragraphs, single line
 * breaks become <br>. Repeated spaces are kept with non-breaking spaces so
 * the text renders as typed. Text is only ever inserted as text nodes.
 */
export function textToFragment(text, doc = document) {
    const fragment = doc.createDocumentFragment();
    const normalized = String(text).replace(/\r\n?/g, '\n');

    for (const block of normalized.split(/\n[ \t]*\n/)) {
        if (block.trim() === '') {
            continue;
        }

        const paragraph = doc.createElement('p');
        const lines = block.replace(/^\n+|\n+$/g, '').split('\n');

        lines.forEach((line, index) => {
            if (index > 0) {
                paragraph.appendChild(doc.createElement('br'));
            }

            const preserved = line
                .replace(/\t/g, '    ')
                .replace(/^ +/, (spaces) => '\u00A0'.repeat(spaces.length))
                .replace(/ {2,}/g, (spaces) => ` ${'\u00A0'.repeat(spaces.length - 1)}`)
                .replace(/ $/, '\u00A0');

            if (preserved) {
                paragraph.appendChild(doc.createTextNode(preserved));
            }
        });

        fragment.appendChild(paragraph);
    }

    return fragment;
}

/**
 * Clean tree to readable plain text. Paragraph-level blocks are separated
 * by blank lines; list items keep a "- " or "1. " prefix; table cells are
 * separated by " | ". Images, rules and formatting are dropped.
 */
export function treeToText(root) {
    const blocks = [];

    const inline = (node) => {
        let text = '';

        for (const child of node.childNodes) {
            if (isText(child)) {
                text += child.data;
            } else if (isElement(child)) {
                if (child.nodeName === 'BR') {
                    text += '\n';
                } else if (child.nodeName === 'IMG') {
                    continue;
                } else if (child.nodeName === 'UL' || child.nodeName === 'OL') {
                    continue;
                } else {
                    text += inline(child);
                }
            }
        }

        return text.replace(/\u00A0/g, ' ');
    };

    const list = (node, depth) => {
        const lines = [];
        let number = Number(node.getAttribute('start') || 1);

        for (const item of node.children) {
            const marker = node.nodeName === 'OL' ? `${number}. ` : '- ';
            const pad = '  '.repeat(depth);
            number += 1;
            lines.push(pad + marker + inline(item).split('\n').join(`\n${pad}${' '.repeat(marker.length)}`));

            for (const nested of item.children) {
                if (nested.nodeName === 'UL' || nested.nodeName === 'OL') {
                    lines.push(list(nested, depth + 1));
                }
            }
        }

        return lines.join('\n');
    };

    const walk = (parent) => {
        for (const node of parent.children) {
            const tag = node.nodeName;

            if (tag === 'UL' || tag === 'OL') {
                blocks.push(list(node, 0));
            } else if (tag === 'BLOCKQUOTE') {
                walk(node);
            } else if (tag === 'PRE') {
                blocks.push(node.textContent.replace(/\n$/, ''));
            } else if (tag === 'TABLE') {
                blocks.push(Array.from(node.querySelectorAll('tr')).map((row) => Array.from(row.children).map((cell) => inline(cell).replace(/\n/g, ' ').trim()).join(' | ')).join('\n'));
            } else if (tag === 'FIGURE') {
                const caption = node.querySelector('figcaption');

                if (caption) {
                    blocks.push(inline(caption));
                }
            } else if (tag === 'HR') {
                continue;
            } else if (BLOCK_TAGS.has(tag)) {
                blocks.push(inline(node));
            }
        }
    };

    walk(root);

    return blocks.filter((block) => block.trim() !== '').join('\n\n');
}

export { extractText };
