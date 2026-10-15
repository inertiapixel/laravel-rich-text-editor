/**
 * Selection and Range helpers scoped to one editing root.
 */

import { TEXT_BLOCKS, isElement, isText } from './dom.js';

export const MARKER_ATTRIBUTE = 'data-ipx-rte-marker';

export function getRange(root) {
    const selection = root.ownerDocument.getSelection();

    if (!selection || selection.rangeCount === 0) {
        return null;
    }

    const range = selection.getRangeAt(0);

    return root.contains(range.commonAncestorContainer) ? range : null;
}

export function setRange(range) {
    const selection = range.startContainer.ownerDocument.getSelection();

    selection.removeAllRanges();
    selection.addRange(range);
}

export function placeCaret(node, offset) {
    const range = node.ownerDocument.createRange();

    range.setStart(node, offset);
    range.collapse(true);
    setRange(range);

    return range;
}

export function placeCaretAtStart(block) {
    let target = block;

    while (target.firstChild && !isText(target) && !isVoid(target.firstChild)) {
        target = target.firstChild;
    }

    return placeCaret(target, 0);
}

export function placeCaretAtEnd(block) {
    let target = block;

    while (target.lastChild && isElement(target.lastChild) && !isVoid(target.lastChild) && target.lastChild.nodeName !== 'UL' && target.lastChild.nodeName !== 'OL') {
        target = target.lastChild;
    }

    if (target.lastChild && isText(target.lastChild)) {
        return placeCaret(target.lastChild, target.lastChild.length);
    }

    let offset = target.childNodes.length;

    // Never place the caret after a trailing placeholder <br>.
    if (offset > 0 && target.childNodes[offset - 1].nodeName === 'BR') {
        offset -= 1;
    }

    return placeCaret(target, offset);
}

function isVoid(node) {
    return isElement(node) && (node.nodeName === 'BR' || node.nodeName === 'IMG' || node.nodeName === 'HR');
}

/**
 * Insert invisible marker elements at the range boundaries so the
 * selection survives DOM restructuring. Restore with restoreMarkers().
 */
export function insertMarkers(range) {
    const doc = range.startContainer.ownerDocument;
    const end = doc.createElement('span');
    end.setAttribute(MARKER_ATTRIBUTE, 'end');

    const collapsed = range.collapsed;

    if (!collapsed) {
        const endRange = range.cloneRange();
        endRange.collapse(false);
        endRange.insertNode(end);
    }

    const start = doc.createElement('span');
    start.setAttribute(MARKER_ATTRIBUTE, 'start');

    const startRange = range.cloneRange();
    startRange.collapse(true);
    startRange.insertNode(start);

    return { start, end: collapsed ? null : end };
}

export function restoreMarkers(root, select = true) {
    const start = root.querySelector(`[${MARKER_ATTRIBUTE}="start"]`);
    const end = root.querySelector(`[${MARKER_ATTRIBUTE}="end"]`);

    if (!start) {
        if (end) {
            end.remove();
        }

        return null;
    }

    const range = root.ownerDocument.createRange();
    const startParent = start.parentNode;
    const endParent = end ? end.parentNode : null;

    range.setStartBefore(start);

    if (end) {
        range.setEndBefore(end);
    } else {
        range.collapse(true);
    }

    start.remove();

    if (end) {
        end.remove();
    }

    // Merge text nodes split by the markers; live ranges follow the merge.
    startParent.normalize();

    if (endParent && endParent !== startParent && endParent.isConnected) {
        endParent.normalize();
    }

    if (select) {
        setRange(range);
    }

    return range;
}

export function removeMarkers(root) {
    for (const marker of Array.from(root.querySelectorAll(`[${MARKER_ATTRIBUTE}]`))) {
        const parent = marker.parentNode;

        marker.remove();
        parent.normalize();
    }
}

/**
 * Closest block that holds inline content (p, h1-6, pre, li, td, th,
 * figcaption) for a node inside root.
 */
export function textBlockOf(node, root) {
    let current = isText(node) ? node.parentNode : node;

    while (current && current !== root) {
        if (TEXT_BLOCKS.has(current.nodeName)) {
            return current;
        }

        current = current.parentNode;
    }

    return null;
}

/** The top-level child of root that contains node. */
export function topBlockOf(node, root) {
    let current = node;

    while (current && current.parentNode !== root) {
        current = current.parentNode;
    }

    return current && current.parentNode === root ? current : null;
}

function ownContentIntersects(block, range) {
    let hasOwnContent = false;

    for (const child of block.childNodes) {
        if (isElement(child) && (TEXT_BLOCKS.has(child.nodeName) || child.nodeName === 'UL' || child.nodeName === 'OL' || child.nodeName === 'TABLE')) {
            continue;
        }

        hasOwnContent = true;

        if (range.intersectsNode(child)) {
            return true;
        }
    }

    if (!hasOwnContent) {
        return range.intersectsNode(block);
    }

    // Collapsed caret directly inside the block element itself.
    return range.startContainer === block || range.endContainer === block;
}

function rangeEndsAtStartOf(range, block) {
    if (range.collapsed) {
        return false;
    }

    const probe = block.ownerDocument.createRange();
    probe.selectNodeContents(block);
    probe.collapse(true);

    const before = range.cloneRange();
    before.setStart(probe.startContainer, probe.startOffset);

    return before.toString() === '' && !before.cloneContents().querySelector('img');
}

/**
 * Text blocks touched by the range, in document order.
 */
export function selectedTextBlocks(root, range) {
    if (range.collapsed) {
        const block = textBlockOf(range.startContainer, root);

        return block ? [block] : [];
    }

    const blocks = [];

    for (const block of root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, pre, li, td, th, figcaption')) {
        if (range.intersectsNode(block) && ownContentIntersects(block, range)) {
            blocks.push(block);
        }
    }

    // A selection ending at the very start of a block does not select it.
    while (blocks.length > 1 && rangeEndsAtStartOf(range, blocks[blocks.length - 1])) {
        blocks.pop();
    }

    return blocks;
}

/**
 * Split `ancestor` at the range boundary point, returning the new right
 * part (inserted after the original). Children of the boundary move into
 * the right part. Works like Range.extractContents() on [point, end].
 */
export function splitAt(ancestor, container, offset) {
    const doc = ancestor.ownerDocument;
    const range = doc.createRange();

    range.setStart(container, offset);
    range.setEnd(ancestor, ancestor.childNodes.length);

    const tail = range.extractContents();
    const right = ancestor.cloneNode(false);

    right.appendChild(tail);
    ancestor.parentNode.insertBefore(right, ancestor.nextSibling);

    return right;
}

/** Is the collapsed range at the very start of `block`'s own content? */
export function isAtStart(range, block) {
    const probe = block.ownerDocument.createRange();

    probe.selectNodeContents(block);
    probe.setEnd(range.startContainer, range.startOffset);

    return probe.toString().replace(/[\u200B\uFEFF]/g, '') === '' && !probe.cloneContents().querySelector('img');
}

/** Is the collapsed range at the very end of `block`'s own content? */
export function isAtEnd(range, block) {
    const probe = block.ownerDocument.createRange();

    probe.selectNodeContents(block);
    probe.setStart(range.endContainer, range.endOffset);

    const fragment = probe.cloneContents();

    for (const list of Array.from(fragment.querySelectorAll('ul, ol'))) {
        list.remove();
    }

    return fragment.textContent.replace(/[\u200B\uFEFF]/g, '') === '' && !fragment.querySelector('img');
}

/** All text nodes within the range (partially selected ones included). */
export function textNodesInRange(range) {
    const root = range.commonAncestorContainer;
    const nodes = [];

    if (isText(root)) {
        return [root];
    }

    const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    let node = walker.nextNode();

    while (node) {
        if (range.intersectsNode(node) && node.length > 0) {
            nodes.push(node);
        }

        node = walker.nextNode();
    }

    return nodes;
}

/**
 * Split text nodes at the range boundaries so the range covers whole
 * text nodes. Returns the fully selected text nodes.
 */
export function isolateTextNodes(range) {
    let { startContainer, startOffset, endContainer, endOffset } = range;

    if (isText(endContainer) && endOffset > 0 && endOffset < endContainer.length) {
        endContainer.splitText(endOffset);
    }

    if (isText(startContainer) && startOffset > 0 && startOffset < startContainer.length) {
        const tail = startContainer.splitText(startOffset);

        if (endContainer === startContainer) {
            endContainer = tail;
            endOffset -= startOffset;
        }

        startContainer = tail;
        startOffset = 0;
    }

    range.setStart(startContainer, startOffset);
    range.setEnd(endContainer, endOffset);

    return textNodesInRange(range).filter((node) => {
        if (node === range.startContainer && range.startOffset >= node.length) {
            return false;
        }

        if (node === range.endContainer && range.endOffset === 0) {
            return false;
        }

        return node.data.replace(/[\u200B\uFEFF]/g, '') !== '';
    });
}
