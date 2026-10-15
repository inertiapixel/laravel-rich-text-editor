/**
 * Small DOM helpers shared by every module. Nothing here touches globals.
 */

export const BLOCK_TAGS = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'PRE',
    'HR', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'FIGURE', 'FIGCAPTION',
    'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'MAIN', 'ADDRESS',
    'DL', 'DT', 'DD', 'CAPTION', 'CENTER', 'DETAILS', 'SUMMARY', 'FORM', 'FIELDSET',
]);

/** Blocks that directly hold inline content in the saved document. */
export const TEXT_BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'LI', 'TD', 'TH', 'FIGCAPTION']);

export const HEADINGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

export const INLINE_MARKS = ['STRONG', 'EM', 'U', 'S', 'CODE'];

export function el(doc, tag, attrs, children) {
    const node = doc.createElement(tag);

    if (attrs) {
        for (const [key, value] of Object.entries(attrs)) {
            if (value === null || value === undefined || value === false) {
                continue;
            }

            if (key === 'text') {
                node.textContent = value;
            } else if (key === 'className') {
                node.className = value;
            } else {
                node.setAttribute(key, value === true ? '' : String(value));
            }
        }
    }

    if (children) {
        for (const child of children) {
            if (child !== null && child !== undefined) {
                node.append(child);
            }
        }
    }

    return node;
}

export function isElement(node) {
    return !!node && node.nodeType === 1;
}

export function isText(node) {
    return !!node && node.nodeType === 3;
}

export function isBlock(node) {
    return isElement(node) && BLOCK_TAGS.has(node.nodeName);
}

export function closest(node, predicate, root) {
    let current = node;

    while (current && current !== root) {
        if (isElement(current) && predicate(current)) {
            return current;
        }

        current = current.parentNode;
    }

    return null;
}

export function closestTag(node, tags, root) {
    const set = typeof tags === 'string' ? new Set([tags]) : tags;

    return closest(node, (element) => set.has(element.nodeName), root);
}

export function unwrap(node) {
    const parent = node.parentNode;

    if (!parent) {
        return;
    }

    while (node.firstChild) {
        parent.insertBefore(node.firstChild, node);
    }

    parent.removeChild(node);
}

export function rename(node, tag) {
    if (node.nodeName === tag.toUpperCase()) {
        return node;
    }

    const replacement = node.ownerDocument.createElement(tag);

    for (const attribute of Array.from(node.attributes)) {
        replacement.setAttribute(attribute.name, attribute.value);
    }

    while (node.firstChild) {
        replacement.appendChild(node.firstChild);
    }

    node.parentNode.replaceChild(replacement, node);

    return replacement;
}

export function insertAfter(node, reference) {
    reference.parentNode.insertBefore(node, reference.nextSibling);
}

/** True when a block has no visible content (ignoring a placeholder <br>). */
export function isEmptyBlock(node) {
    if (node.querySelector('img, hr, table')) {
        return false;
    }

    return node.textContent.replace(/[\u200B\uFEFF]/g, '') === '';
}

export function ensurePlaceholder(block) {
    if (block.nodeName === 'PRE' || block.nodeName === 'HR' || block.nodeName === 'TABLE') {
        return;
    }

    if (isEmptyBlock(block) && !block.querySelector('br')) {
        block.appendChild(block.ownerDocument.createElement('br'));
    }
}

export function classList(node) {
    return (node.getAttribute('class') || '').split(/\s+/).filter(Boolean);
}

export function setClasses(node, classes) {
    const unique = Array.from(new Set(classes.filter(Boolean)));

    if (unique.length) {
        node.setAttribute('class', unique.join(' '));
    } else {
        node.removeAttribute('class');
    }
}

export function replaceClassPrefix(node, prefix, replacement) {
    const classes = classList(node).filter((name) => !name.startsWith(prefix));

    if (replacement) {
        classes.push(replacement);
    }

    setClasses(node, classes);
}

/** Count Unicode code points (the same unit as PHP mb_strlen). */
export function codePointLength(text) {
    let count = 0;

    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);

        // Skip the low half of a surrogate pair.
        if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
            const next = text.charCodeAt(index + 1);

            if (next >= 0xdc00 && next <= 0xdfff) {
                index += 1;
            }
        }

        count += 1;
    }

    return count;
}

/** Slice a string by code points. */
export function codePointSlice(text, length) {
    return Array.from(text).slice(0, Math.max(0, length)).join('');
}

let uid = 0;

export function uniqueId(prefix) {
    uid += 1;

    return `${prefix}-${uid}`;
}
