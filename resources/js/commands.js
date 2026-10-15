/**
 * Rich-text commands implemented with DOM and Range operations.
 * document.execCommand() is not used.
 *
 * Every command works on the editing surface of one editor instance and
 * leaves the selection where the user expects it.
 */

import {
    HEADINGS,
    INLINE_MARKS,
    TEXT_BLOCKS,
    classList,
    closestTag,
    ensurePlaceholder,
    insertAfter,
    isElement,
    isEmptyBlock,
    isText,
    rename,
    setClasses,
    unwrap,
} from './dom.js';
import {
    getRange,
    insertMarkers,
    isAtEnd,
    isAtStart,
    isolateTextNodes,
    placeCaret,
    placeCaretAtEnd,
    placeCaretAtStart,
    restoreMarkers,
    selectedTextBlocks,
    setRange,
    splitAt,
    textBlockOf,
    topBlockOf,
} from './selection.js';
import { mergeAdjacentMarks } from './serializer.js';

const MARK_TAGS = { bold: 'STRONG', italic: 'EM', underline: 'U', strikethrough: 'S', inline_code: 'CODE' };

export { MARK_TAGS };

const LISTS = new Set(['UL', 'OL']);

// ---------------------------------------------------------------------------
// Structure guards
// ---------------------------------------------------------------------------

const SURFACE_BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE', 'TABLE', 'HR', 'FIGURE', 'PRE']);

/**
 * Make sure the surface only holds blocks (stray inline content is wrapped
 * in a paragraph), holds at least one paragraph, and that empty blocks
 * keep a placeholder <br> so they can receive the caret.
 */
export function ensureStructure(surface) {
    const doc = surface.ownerDocument;
    let stray = null;

    for (const child of Array.from(surface.childNodes)) {
        if (isElement(child) && SURFACE_BLOCKS.has(child.nodeName)) {
            stray = null;
            continue;
        }

        if (isText(child) && child.data.trim() === '' && !stray) {
            child.remove();
            continue;
        }

        if (!stray) {
            stray = doc.createElement('p');
            surface.insertBefore(stray, child);
        }

        stray.appendChild(child);
    }

    if (!surface.firstElementChild) {
        surface.appendChild(doc.createElement('p'));
    }

    for (const block of surface.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote')) {
        if (block.nodeName === 'BLOCKQUOTE') {
            if (!block.firstElementChild) {
                block.appendChild(doc.createElement('p'));
            }

            continue;
        }

        ensurePlaceholder(block);
    }
}

/** Return a collapsed range guaranteed to sit inside a text block. */
export function caretRange(surface) {
    let range = getRange(surface);

    if (!range) {
        placeCaretAtEnd(lastTextBlock(surface) || surface);
        range = getRange(surface);
    }

    if (range && !textBlockOf(range.startContainer, surface)) {
        ensureStructure(surface);

        const target = surface.childNodes[Math.min(range.startOffset, surface.childNodes.length - 1)] || surface.firstElementChild;
        const block = target && TEXT_BLOCKS.has(target.nodeName) ? target : surface.querySelector('p, h1, h2, h3, h4, h5, h6, li, td, th, pre');

        if (block) {
            placeCaretAtEnd(block);
            range = getRange(surface);
        }
    }

    return range;
}

function lastTextBlock(surface) {
    const blocks = surface.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, pre');

    return blocks[blocks.length - 1] || null;
}

// ---------------------------------------------------------------------------
// Inline marks
// ---------------------------------------------------------------------------

function isolateFromAncestor(node, ancestor) {
    const doc = node.ownerDocument;
    const before = doc.createRange();

    before.setStart(ancestor, 0);
    before.setEndBefore(node);

    if (!before.collapsed) {
        const left = ancestor.cloneNode(false);
        left.appendChild(before.extractContents());
        ancestor.parentNode.insertBefore(left, ancestor);
    }

    const after = doc.createRange();
    after.setStartAfter(node);
    after.setEnd(ancestor, ancestor.childNodes.length);

    if (!after.collapsed) {
        const right = ancestor.cloneNode(false);
        right.appendChild(after.extractContents());
        insertAfter(right, ancestor);
    }

    unwrap(ancestor);
}

function removeMark(node, tag, surface) {
    let ancestor = closestTag(node, tag, surface);

    while (ancestor) {
        isolateFromAncestor(node, ancestor);
        ancestor = closestTag(node, tag, surface);
    }
}

function cleanupInline(blocks) {
    for (const block of blocks) {
        if (!block.isConnected) {
            continue;
        }

        for (const element of Array.from(block.querySelectorAll('strong, em, u, s, code, a'))) {
            if (element.closest('pre')) {
                continue;
            }

            if (element.textContent === '' && !element.querySelector('img, br, [data-ipx-rte-marker]')) {
                element.remove();
            }
        }

        mergeAdjacentMarks(block);
    }
}

/** Is `tag` active for the whole (non-collapsed) range or at the caret? */
export function isMarkActive(surface, range, tag) {
    if (range.collapsed) {
        return !!closestTag(range.startContainer, tag, surface);
    }

    const probe = range.cloneRange();
    const texts = [];
    const walker = surface.ownerDocument.createTreeWalker(probe.commonAncestorContainer.nodeType === 3 ? probe.commonAncestorContainer.parentNode : probe.commonAncestorContainer, 4);
    let node = walker.nextNode();

    while (node) {
        if (probe.intersectsNode(node) && node.data.trim() !== '') {
            const partial = (node === probe.startContainer && probe.startOffset >= node.length) || (node === probe.endContainer && probe.endOffset === 0);

            if (!partial) {
                texts.push(node);
            }
        }

        node = walker.nextNode();
    }

    if (!texts.length) {
        return !!closestTag(range.startContainer, tag, surface);
    }

    return texts.every((text) => closestTag(text, tag, surface));
}

/**
 * Toggle an inline mark on the selection. With a collapsed selection the
 * mark is stored as pending and applied to the next typed text.
 */
export function toggleMark(surface, tag, state) {
    const range = getRange(surface);

    if (!range) {
        return false;
    }

    if (range.collapsed) {
        const pending = state.pendingMarks;

        if (pending.has(tag)) {
            pending.delete(tag);
        } else {
            pending.add(tag);
        }

        state.pendingAt = { node: range.startContainer, offset: range.startOffset };

        return 'pending';
    }

    const active = isMarkActive(surface, range, tag);
    const texts = isolateTextNodes(range).filter((text) => !closestTag(text, 'PRE', surface));

    if (!texts.length) {
        return false;
    }

    const blocks = new Set(texts.map((text) => textBlockOf(text, surface)).filter(Boolean));

    for (const text of texts) {
        if (active) {
            removeMark(text, tag, surface);
        } else if (!closestTag(text, tag, surface)) {
            const wrapper = surface.ownerDocument.createElement(tag.toLowerCase());
            text.parentNode.insertBefore(wrapper, text);
            wrapper.appendChild(text);
        }
    }

    const selection = surface.ownerDocument.createRange();
    selection.setStart(texts[0], 0);
    selection.setEnd(texts[texts.length - 1], texts[texts.length - 1].length);
    insertMarkers(selection);
    cleanupInline(blocks);
    restoreMarkers(surface);

    return true;
}

/** The text character right before a point inside `block`, if any. */
function previousCharacter(block, container, offset) {
    const doc = block.ownerDocument;
    const probe = doc.createRange();

    probe.setStart(block, 0);
    probe.setEnd(container, offset);

    const walker = doc.createTreeWalker(block, 4 /* SHOW_TEXT */);
    let last = null;
    let node = walker.nextNode();

    while (node && probe.intersectsNode(node)) {
        if (node !== container || offset > 0) {
            last = node;
        }

        node = walker.nextNode();
    }

    if (!last) {
        return null;
    }

    const end = last === container ? offset : last.length;

    return end > 0 ? { node: last, index: end - 1, char: last.data[end - 1] } : null;
}

function hasVisibleContentAfter(block, node) {
    const probe = block.ownerDocument.createRange();

    probe.setStartAfter(node);
    probe.setEnd(block, block.childNodes.length);

    return probe.toString().replace(/[\t\n\r\f ]/g, '') !== '' || !!probe.cloneContents().querySelector('img');
}

/**
 * Make manually inserted text render like typed text: spaces that would
 * collapse (at the block edges or next to another space) become
 * non-breaking, and a non-breaking space the browser used as a trailing
 * space becomes a normal space once text follows it.
 */
function balanceSpaces(block, textNode, previous) {
    let data = textNode.data;
    const before = previous ? previous.char : null;

    if (data.startsWith(' ') && (before === null || before === ' ' || before === '\u00A0')) {
        data = `\u00A0${data.slice(1)}`;
    }

    data = data.replace(/ {2}/g, ' \u00A0');

    if (data.endsWith(' ') && !hasVisibleContentAfter(block, textNode)) {
        data = `${data.slice(0, -1)}\u00A0`;
    }

    if (data !== textNode.data) {
        textNode.data = data;
    }

    if (previous && previous.char === '\u00A0' && !/^[ \u00A0]/.test(data) && previous.node.data[previous.index - 1] !== ' ' && previous.node.data[previous.index - 1] !== '\u00A0') {
        previous.node.replaceData(previous.index, 1, ' ');
    }
}

/**
 * After a character is typed natively, turn a non-breaking space right
 * before it into a normal space when a word precedes it. Browsers do this
 * within one text node but not across element boundaries (for example
 * right after a <strong>).
 */
export function relaxSpaceBeforeCaret(surface) {
    const range = getRange(surface);

    if (!range || !range.collapsed || !isText(range.startContainer)) {
        return;
    }

    const node = range.startContainer;
    const index = range.startOffset - 2;

    if (index < 0 || node.data[index] !== '\u00A0' || /[ \u00A0]/.test(node.data[index + 1] || ' ')) {
        return;
    }

    const block = textBlockOf(node, surface);

    if (!block || block.nodeName === 'PRE') {
        return;
    }

    const before = index > 0 ? { char: node.data[index - 1] } : previousCharacter(block, node, 0);

    if (before && !/[\s\u00A0]/.test(before.char)) {
        node.replaceData(index, 1, ' ');
        placeCaret(node, index + 2);
    }
}

/**
 * After inline content is inserted right after typed text, a trailing
 * non-breaking space the browser used becomes a normal space.
 */
export function relaxSpaceBefore(surface, node) {
    const block = textBlockOf(node, surface);

    if (!block || block.nodeName === 'PRE' || !node.parentNode) {
        return;
    }

    const previous = previousCharacter(block, node.parentNode, Array.prototype.indexOf.call(node.parentNode.childNodes, node));

    if (previous && previous.char === '\u00A0' && previous.index > 0 && !/[\s\u00A0]/.test(previous.node.data[previous.index - 1])) {
        previous.node.replaceData(previous.index, 1, ' ');
    }
}

/**
 * Insert typed text at a collapsed range, applying pending mark toggles.
 */
export function insertTextWithMarks(surface, range, text, toggles) {
    const doc = surface.ownerDocument;
    let point = { container: range.startContainer, offset: range.startOffset };
    const enable = [];
    const startBlock = textBlockOf(point.container, surface);
    const previous = startBlock ? previousCharacter(startBlock, point.container, point.offset) : null;

    for (const tag of toggles) {
        const ancestor = closestTag(point.container, tag, surface);

        if (ancestor) {
            // Leave the mark: split it at the caret and insert between.
            const right = splitAt(ancestor, point.container, point.offset);
            const parent = ancestor.parentNode;
            point = { container: parent, offset: Array.prototype.indexOf.call(parent.childNodes, ancestor) + 1 };

            if (!right.textContent && !right.querySelector('img, br')) {
                right.remove();
            }
        } else {
            enable.push(tag);
        }
    }

    const textNode = doc.createTextNode(text);
    let node = textNode;

    for (const tag of enable) {
        const wrapper = doc.createElement(tag.toLowerCase());
        wrapper.appendChild(node);
        node = wrapper;
    }

    const insertion = doc.createRange();
    insertion.setStart(point.container, point.offset);
    insertion.collapse(true);
    insertion.insertNode(node);

    // Drop a placeholder <br> that is no longer needed.
    const block = textBlockOf(textNode, surface);

    if (block && block.lastChild && block.lastChild.nodeName === 'BR' && block.lastChild.previousSibling) {
        if (block.lastChild.previousSibling.nodeName !== 'BR') {
            block.lastChild.remove();
        }
    }

    if (block && block.nodeName !== 'PRE') {
        balanceSpaces(block, textNode, previous && previous.node.isConnected ? previous : null);
    }

    placeCaret(textNode, textNode.length);
}

// ---------------------------------------------------------------------------
// Block formatting
// ---------------------------------------------------------------------------

export function currentBlockType(surface, range) {
    const block = textBlockOf(range.startContainer, surface);

    if (!block) {
        return 'p';
    }

    if (HEADINGS.has(block.nodeName)) {
        return block.nodeName.toLowerCase();
    }

    if (block.nodeName === 'PRE') {
        return 'pre';
    }

    return 'p';
}

function preToParagraphs(pre) {
    const doc = pre.ownerDocument;
    const lines = pre.textContent.replace(/\n$/, '').split('\n');
    const paragraphs = lines.map((line) => {
        const paragraph = doc.createElement('p');

        if (line) {
            paragraph.appendChild(doc.createTextNode(line));
        } else {
            paragraph.appendChild(doc.createElement('br'));
        }

        return paragraph;
    });

    for (const paragraph of paragraphs) {
        pre.parentNode.insertBefore(paragraph, pre);
    }

    pre.remove();

    return paragraphs;
}

/** Set paragraph/heading type (tag: "p" or "h1"..."h6") on selected blocks. */
export function setBlockType(surface, tag) {
    const range = getRange(surface);

    if (!range) {
        return false;
    }

    const blocks = selectedTextBlocks(surface, range);
    let last = null;

    insertMarkers(range);

    for (const block of blocks) {
        if (block.nodeName === 'PRE') {
            const paragraphs = preToParagraphs(block).map((paragraph) => (tag === 'p' ? paragraph : rename(paragraph, tag)));
            last = paragraphs[paragraphs.length - 1] || last;

            continue;
        }

        if (block.nodeName === 'P' || HEADINGS.has(block.nodeName)) {
            // Alignment and indentation classes are kept.
            last = rename(block, tag);
            ensurePlaceholder(last);
        }
    }

    // Markers inside a converted code block are gone; fall back to the end.
    if (!restoreMarkers(surface) && last) {
        placeCaretAtEnd(last);
    }

    return true;
}

function topLevelUnits(surface, blocks) {
    const units = [];

    for (const block of blocks) {
        let unit = block;

        // Lift to the child of the surface or of a blockquote.
        while (unit.parentNode && unit.parentNode !== surface && unit.parentNode.nodeName !== 'BLOCKQUOTE') {
            unit = unit.parentNode;
        }

        if (!units.includes(unit)) {
            units.push(unit);
        }
    }

    return units;
}

export function toggleBlockquote(surface) {
    const range = getRange(surface);

    if (!range) {
        return false;
    }

    const blocks = selectedTextBlocks(surface, range);

    if (!blocks.length) {
        return false;
    }

    insertMarkers(range);

    const quotes = blocks.map((block) => closestTag(block, 'BLOCKQUOTE', surface));

    if (quotes.every(Boolean)) {
        for (const quote of new Set(quotes)) {
            if (quote.isConnected) {
                unwrap(quote);
            }
        }
    } else {
        const units = topLevelUnits(surface, blocks);
        const groups = [];

        for (const unit of units) {
            const group = groups[groups.length - 1];

            if (group && group.parent === unit.parentNode && group.items[group.items.length - 1].nextElementSibling === unit) {
                group.items.push(unit);
            } else {
                groups.push({ parent: unit.parentNode, items: [unit] });
            }
        }

        for (const group of groups) {
            const quote = surface.ownerDocument.createElement('blockquote');
            group.parent.insertBefore(quote, group.items[0]);

            for (const item of group.items) {
                if (item.nodeName === 'BLOCKQUOTE') {
                    while (item.firstChild) {
                        quote.appendChild(item.firstChild);
                    }

                    item.remove();
                } else {
                    quote.appendChild(item);
                }
            }
        }
    }

    restoreMarkers(surface);

    return true;
}

export function toggleCodeBlock(surface) {
    const range = getRange(surface);

    if (!range) {
        return false;
    }

    const blocks = selectedTextBlocks(surface, range).filter((block) => block.nodeName === 'PRE' || block.nodeName === 'P' || HEADINGS.has(block.nodeName));

    if (!blocks.length) {
        return false;
    }

    const doc = surface.ownerDocument;

    if (blocks.every((block) => block.nodeName === 'PRE')) {
        insertMarkers(range);
        let last = null;

        for (const block of blocks) {
            const paragraphs = preToParagraphs(block);
            last = paragraphs[paragraphs.length - 1];
        }

        if (!restoreMarkers(surface) && last) {
            placeCaretAtEnd(last);
        }

        return true;
    }

    const lines = [];

    for (const block of blocks) {
        if (block.nodeName === 'PRE') {
            lines.push(block.textContent.replace(/\n$/, ''));
        } else {
            lines.push(blockText(block));
        }
    }

    const pre = doc.createElement('pre');
    const code = doc.createElement('code');
    const text = doc.createTextNode(lines.join('\n'));

    code.appendChild(text);
    pre.appendChild(code);
    blocks[0].parentNode.insertBefore(pre, blocks[0]);

    for (const block of blocks) {
        block.remove();
    }

    placeCaret(text, text.length);

    return true;
}

function blockText(block) {
    let text = '';

    for (const child of block.childNodes) {
        if (isText(child)) {
            text += child.data;
        } else if (child.nodeName === 'BR') {
            if (child.nextSibling) {
                text += '\n';
            }
        } else if (isElement(child) && !LISTS.has(child.nodeName)) {
            text += blockText(child);
        }
    }

    return text.replace(/\u00A0/g, ' ');
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export function currentListType(surface, range) {
    const item = closestTag(range.startContainer, 'LI', surface);

    return item ? item.parentNode.nodeName : null;
}

function mergeWithSiblingLists(list) {
    const previous = list.previousElementSibling;

    if (previous && previous.nodeName === list.nodeName && !previous.hasAttribute('start') && !list.hasAttribute('start')) {
        while (list.firstChild) {
            previous.appendChild(list.firstChild);
        }

        list.remove();
        list = previous;
    }

    const next = list.nextElementSibling;

    if (next && next.nodeName === list.nodeName && !next.hasAttribute('start')) {
        while (next.firstChild) {
            list.appendChild(next.firstChild);
        }

        next.remove();
    }

    return list;
}

/** Turn a top-level list item into a paragraph, splitting its list. */
function liftItemOutOfList(item) {
    const doc = item.ownerDocument;
    const list = item.parentNode;
    const after = doc.createElement(list.nodeName.toLowerCase());

    while (item.nextSibling) {
        after.appendChild(item.nextSibling);
    }

    const paragraph = doc.createElement('p');
    const nested = [];

    for (const child of Array.from(item.childNodes)) {
        if (isElement(child) && LISTS.has(child.nodeName)) {
            nested.push(child);
        } else {
            paragraph.appendChild(child);
        }
    }

    for (const name of classList(item)) {
        if (name.startsWith('ipx-rte-text-')) {
            paragraph.classList.add(name);
        }
    }

    ensurePlaceholder(paragraph);
    insertAfter(paragraph, list);

    let reference = paragraph;

    for (const sub of nested) {
        insertAfter(sub, reference);
        reference = sub;
    }

    if (after.firstChild) {
        insertAfter(after, reference);
    }

    item.remove();

    if (!list.firstElementChild) {
        list.remove();
    }

    return paragraph;
}

function outdentItem(item, surface) {
    const list = item.parentNode;
    const parentItem = list.parentNode && list.parentNode.nodeName === 'LI' ? list.parentNode : null;

    if (!parentItem) {
        return liftItemOutOfList(item);
    }

    // Following siblings become children of the outdented item.
    if (item.nextElementSibling) {
        const rest = item.ownerDocument.createElement(list.nodeName.toLowerCase());

        while (item.nextSibling) {
            rest.appendChild(item.nextSibling);
        }

        item.appendChild(rest);
    }

    insertAfter(item, parentItem);

    if (!list.firstElementChild) {
        list.remove();
    }

    ensurePlaceholder(parentItem);

    return item;
}

function indentItem(item) {
    const previous = item.previousElementSibling;

    if (!previous || previous.nodeName !== 'LI') {
        return false;
    }

    const listTag = item.parentNode.nodeName;
    let nested = previous.lastElementChild;

    if (!nested || !LISTS.has(nested.nodeName)) {
        nested = item.ownerDocument.createElement(listTag.toLowerCase());
        previous.appendChild(nested);
    }

    nested.appendChild(item);

    // Lists nested under the moved item stay with it; merge a trailing
    // nested list of the same type into the new parent list.
    const own = item.lastElementChild;

    if (own && own.nodeName === nested.nodeName && own !== nested) {
        while (own.firstChild) {
            nested.appendChild(own.firstChild);
        }

        own.remove();
    }

    return true;
}

function selectedItems(surface, blocks) {
    const items = blocks.filter((block) => block.nodeName === 'LI');

    // Skip items whose ancestor item is also selected.
    return items.filter((item) => !items.some((other) => other !== item && other.contains(item)));
}

export function toggleList(surface, listTag) {
    const range = getRange(surface);

    if (!range) {
        return false;
    }

    const doc = surface.ownerDocument;
    const blocks = selectedTextBlocks(surface, range).filter((block) => !['TD', 'TH', 'FIGCAPTION'].includes(block.nodeName));

    if (!blocks.length) {
        return false;
    }

    insertMarkers(range);

    const allItems = blocks.every((block) => block.nodeName === 'LI');

    if (allItems && blocks.every((block) => block.parentNode.nodeName === listTag)) {
        for (const item of selectedItems(surface, blocks).reverse()) {
            outdentItem(item, surface);
        }
    } else if (allItems) {
        for (const list of new Set(blocks.map((block) => block.parentNode))) {
            if (list.nodeName !== listTag) {
                const renamed = rename(list, listTag.toLowerCase());

                if (listTag === 'UL') {
                    renamed.removeAttribute('start');
                }

                mergeWithSiblingLists(renamed);
            }
        }
    } else {
        // Group consecutive sibling blocks; convert each group to one list.
        const groups = [];

        for (const block of blocks) {
            if (block.nodeName === 'LI') {
                continue;
            }

            const group = groups[groups.length - 1];

            if (group && group[group.length - 1].nextElementSibling === block) {
                group.push(block);
            } else {
                groups.push([block]);
            }
        }

        for (const group of groups) {
            const list = doc.createElement(listTag.toLowerCase());
            group[0].parentNode.insertBefore(list, group[0]);

            for (const block of group) {
                if (block.nodeName === 'PRE') {
                    for (const line of block.textContent.replace(/\n$/, '').split('\n')) {
                        const item = doc.createElement('li');
                        item.textContent = line;
                        ensurePlaceholder(item);
                        list.appendChild(item);
                    }

                    // Keep markers that were inside the code block.
                    for (const marker of Array.from(block.querySelectorAll('[data-ipx-rte-marker]'))) {
                        list.lastElementChild.appendChild(marker);
                    }

                    block.remove();
                    continue;
                }

                const item = doc.createElement('li');

                for (const name of classList(block)) {
                    if (name.startsWith('ipx-rte-text-')) {
                        item.classList.add(name);
                    }
                }

                while (block.firstChild) {
                    item.appendChild(block.firstChild);
                }

                ensurePlaceholder(item);
                list.appendChild(item);
                block.remove();
            }

            mergeWithSiblingLists(list);
        }
    }

    restoreMarkers(surface);

    return true;
}

// ---------------------------------------------------------------------------
// Indentation and alignment
// ---------------------------------------------------------------------------

function indentLevel(block) {
    const name = classList(block).find((value) => /^ipx-rte-indent-\d$/.test(value));

    return name ? Number(name.slice('ipx-rte-indent-'.length)) : 0;
}

function setIndentLevel(block, level) {
    setClasses(block, classList(block).filter((name) => !/^ipx-rte-indent-\d$/.test(name)).concat(level > 0 ? [`ipx-rte-indent-${level}`] : []));
}

export function changeIndent(surface, direction, maxIndent) {
    const range = getRange(surface);

    if (!range) {
        return false;
    }

    const blocks = selectedTextBlocks(surface, range);
    const items = selectedItems(surface, blocks);
    let changed = false;

    insertMarkers(range);

    if (items.length) {
        const ordered = direction > 0 ? items : items.slice().reverse();

        for (const item of ordered) {
            if (direction > 0) {
                changed = indentItem(item) || changed;
            } else {
                outdentItem(item, surface);
                changed = true;
            }
        }
    }

    for (const block of blocks) {
        if (block.nodeName === 'P' || HEADINGS.has(block.nodeName)) {
            const level = Math.max(0, Math.min(maxIndent, indentLevel(block) + direction));

            if (level !== indentLevel(block)) {
                setIndentLevel(block, level);
                changed = true;
            }
        }
    }

    restoreMarkers(surface);

    return changed;
}

export function currentAlignment(surface, range) {
    const block = textBlockOf(range.startContainer, surface);
    const name = block ? classList(block).find((value) => /^ipx-rte-text-/.test(value)) : null;

    return name ? name.slice('ipx-rte-text-'.length) : null;
}

export function setAlignment(surface, alignment) {
    const range = getRange(surface);

    if (!range) {
        return false;
    }

    const blocks = selectedTextBlocks(surface, range).filter((block) => block.nodeName !== 'PRE');
    const className = `ipx-rte-text-${alignment}`;
    const active = blocks.length && blocks.every((block) => classList(block).includes(className));

    for (const block of blocks) {
        const classes = classList(block).filter((name) => !/^ipx-rte-text-/.test(name));

        if (!active) {
            classes.push(className);
        }

        setClasses(block, classes);
    }

    return blocks.length > 0;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export function linkAtSelection(surface, range) {
    const link = closestTag(range.startContainer, 'A', surface);

    if (link) {
        return link;
    }

    if (!range.collapsed) {
        const end = closestTag(range.endContainer, 'A', surface);

        if (end) {
            return end;
        }

        const container = range.commonAncestorContainer;

        if (isElement(container)) {
            return Array.from(container.querySelectorAll('a')).find((candidate) => range.intersectsNode(candidate)) || null;
        }
    }

    return null;
}

export function applyLink(surface, range, { href, text, newTab, link }) {
    const doc = surface.ownerDocument;

    const configure = (anchor) => {
        anchor.setAttribute('href', href);

        if (newTab) {
            anchor.setAttribute('target', '_blank');
            anchor.setAttribute('rel', 'noopener noreferrer');
        } else {
            anchor.removeAttribute('target');
            anchor.removeAttribute('rel');
        }
    };

    if (link && link.isConnected) {
        configure(link);

        if (text && text !== link.textContent) {
            link.textContent = text;
        }

        placeCaretAtEnd(link);

        return link;
    }

    setRange(range);

    if (range.collapsed) {
        const anchor = doc.createElement('a');
        configure(anchor);
        anchor.textContent = text || href;
        range.insertNode(anchor);
        relaxSpaceBefore(surface, anchor);
        const after = doc.createRange();
        after.setStartAfter(anchor);
        after.collapse(true);
        setRange(after);

        return anchor;
    }

    // Replace links inside the selection, then wrap the selected text.
    const texts = isolateTextNodes(range).filter((node) => !closestTag(node, 'PRE', surface));

    if (!texts.length) {
        return null;
    }

    for (const node of texts) {
        removeMark(node, 'A', surface);
    }

    let first = null;

    for (const node of texts) {
        const anchor = doc.createElement('a');
        configure(anchor);
        node.parentNode.insertBefore(anchor, node);
        anchor.appendChild(node);
        first = first || anchor;
    }

    const blocks = new Set(texts.map((node) => textBlockOf(node, surface)).filter(Boolean));
    const selection = doc.createRange();

    selection.setStart(texts[0], 0);
    selection.setEnd(texts[texts.length - 1], texts[texts.length - 1].length);
    insertMarkers(selection);
    cleanupInline(blocks);
    restoreMarkers(surface);

    return first;
}

export function removeLink(surface) {
    const range = getRange(surface);

    if (!range) {
        return false;
    }

    const links = new Set();
    const at = linkAtSelection(surface, range);

    if (at) {
        links.add(at);
    }

    if (!range.collapsed) {
        const container = range.commonAncestorContainer;
        const scope = isElement(container) ? container : container.parentNode;

        for (const link of scope.querySelectorAll('a')) {
            if (range.intersectsNode(link)) {
                links.add(link);
            }
        }
    }

    if (!links.size) {
        return false;
    }

    insertMarkers(range);

    for (const link of links) {
        unwrap(link);
    }

    restoreMarkers(surface);

    return true;
}

// ---------------------------------------------------------------------------
// Insertion
// ---------------------------------------------------------------------------

/** Delete the selected content and merge the boundary blocks. */
export function deleteSelection(surface, range) {
    if (range.collapsed) {
        return range;
    }

    const startBlock = textBlockOf(range.startContainer, surface);
    const endBlock = textBlockOf(range.endContainer, surface);

    range.deleteContents();

    if (startBlock && endBlock && startBlock !== endBlock && startBlock.isConnected && endBlock.isConnected
        && !['TD', 'TH'].includes(startBlock.nodeName) && !['TD', 'TH'].includes(endBlock.nodeName)) {
        const marker = surface.ownerDocument.createElement('span');
        marker.setAttribute('data-ipx-rte-marker', 'start');
        range.insertNode(marker);

        if (startBlock.lastChild && startBlock.lastChild.nodeName === 'BR' && endBlock.textContent) {
            startBlock.lastChild.remove();
        }

        while (endBlock.firstChild) {
            if (isElement(endBlock.firstChild) && LISTS.has(endBlock.firstChild.nodeName)) {
                break;
            }

            startBlock.appendChild(endBlock.firstChild);
        }

        const container = endBlock.parentNode;

        if (!endBlock.firstChild) {
            endBlock.remove();
        }

        if (container && container !== surface && (LISTS.has(container.nodeName) || container.nodeName === 'BLOCKQUOTE') && !container.firstElementChild) {
            container.remove();
        }

        ensureStructure(surface);
        ensurePlaceholder(startBlock);

        return restoreMarkers(surface);
    }

    ensureStructure(surface);

    if (startBlock && startBlock.isConnected) {
        ensurePlaceholder(startBlock);
    }

    return caretRange(surface);
}

function flattenFragment(fragment) {
    const doc = fragment.ownerDocument;
    const out = doc.createDocumentFragment();
    let first = true;

    const appendBlock = (block) => {
        if (!first) {
            out.appendChild(doc.createElement('br'));
        }

        first = false;

        for (const child of Array.from(block.childNodes)) {
            if (isElement(child) && (LISTS.has(child.nodeName) || TEXT_BLOCKS.has(child.nodeName) || child.nodeName === 'BLOCKQUOTE' || child.nodeName === 'TABLE')) {
                walk(child);
            } else {
                out.appendChild(child);
            }
        }
    };

    const walk = (container) => {
        for (const child of Array.from(container.childNodes)) {
            if (!isElement(child)) {
                continue;
            }

            if (child.nodeName === 'HR') {
                continue;
            }

            if (child.nodeName === 'PRE') {
                const holder = doc.createElement('p');
                holder.textContent = child.textContent.replace(/\n$/, '');
                appendBlock(holder);
            } else if (TEXT_BLOCKS.has(child.nodeName)) {
                appendBlock(child);
            } else if (child.nodeName === 'FIGURE') {
                const image = child.querySelector('img');

                if (image) {
                    const holder = doc.createElement('p');
                    holder.appendChild(image);
                    appendBlock(holder);
                }
            } else {
                walk(child);
            }
        }
    };

    walk(fragment);

    return out;
}

/**
 * Insert a sanitized fragment at the range (paste, drop, dialogs).
 */
export function insertFragment(surface, range, fragment) {
    const doc = surface.ownerDocument;
    range = deleteSelection(surface, range) || caretRange(surface);

    if (!range) {
        return;
    }

    let block = textBlockOf(range.startContainer, surface);

    if (!block) {
        range = caretRange(surface);
        block = textBlockOf(range.startContainer, surface);
    }

    const blocks = Array.from(fragment.childNodes).filter(isElement);

    if (!blocks.length) {
        return;
    }

    // Code blocks receive plain text.
    if (block.nodeName === 'PRE') {
        const holder = doc.createElement('div');
        holder.appendChild(fragment);
        const text = doc.createTextNode(Array.from(holder.children).map((child) => (child.nodeName === 'PRE' ? child.textContent.replace(/\n$/, '') : child.textContent)).join('\n'));
        range.insertNode(text);
        placeCaret(text, text.length);

        return;
    }

    const inlineOnly = blocks.length === 1 && blocks[0].nodeName === 'P';
    const inlineContainer = ['LI', 'TD', 'TH', 'FIGCAPTION'].includes(block.nodeName);

    if (inlineOnly || inlineContainer) {
        const content = inlineOnly ? doc.createDocumentFragment() : flattenFragment(fragment);

        if (inlineOnly) {
            while (blocks[0].firstChild) {
                content.appendChild(blocks[0].firstChild);
            }
        }

        const first = content.firstChild;
        const last = content.lastChild;

        removePlaceholder(block);
        range.insertNode(content);

        if (first) {
            relaxSpaceBefore(surface, first);
        }

        if (last) {
            const after = doc.createRange();
            after.setStartAfter(last);
            after.collapse(true);
            setRange(after);
        }

        return;
    }

    // Block insertion: split the current block at the caret.
    const right = splitAt(block, range.startContainer, range.startOffset);
    const left = block;
    let reference = left;
    let lastInserted = null;

    for (const node of blocks) {
        insertAfter(node, reference);
        reference = node;
        lastInserted = node;
    }

    // Merge the first inserted paragraph into the left part of the split.
    const leftEmpty = isEmptyBlock(left);

    if (leftEmpty) {
        left.remove();
    } else if (blocks[0].nodeName === 'P' && left.nodeName === 'P' && blocks[0] !== lastInserted) {
        removePlaceholder(left);

        while (blocks[0].firstChild) {
            left.appendChild(blocks[0].firstChild);
        }

        blocks[0].remove();
    }

    if (isEmptyBlock(right)) {
        right.remove();
    }

    if (lastInserted && lastInserted.isConnected) {
        if (TEXT_BLOCKS.has(lastInserted.nodeName) || LISTS.has(lastInserted.nodeName) || lastInserted.nodeName === 'BLOCKQUOTE') {
            placeCaretAtEnd(deepestLastTextBlock(lastInserted));
        } else {
            const next = ensureParagraphAfter(lastInserted);
            placeCaretAtStart(next);
        }
    }

    ensureStructure(surface);
}

function deepestLastTextBlock(node) {
    let current = node;

    while (current && !TEXT_BLOCKS.has(current.nodeName) && current.lastElementChild) {
        current = current.lastElementChild;
    }

    return current || node;
}

function removePlaceholder(block) {
    if (block.childNodes.length === 1 && block.firstChild.nodeName === 'BR') {
        block.firstChild.remove();
    }
}

export function ensureParagraphAfter(node) {
    const next = node.nextElementSibling;

    if (next && (next.nodeName === 'P' || HEADINGS.has(next.nodeName))) {
        return next;
    }

    const paragraph = node.ownerDocument.createElement('p');
    paragraph.appendChild(node.ownerDocument.createElement('br'));
    insertAfter(paragraph, node);

    return paragraph;
}

/**
 * Insert a block element (hr, table, figure) at the caret: the current
 * block is split, and a paragraph follows the inserted block.
 */
export function insertBlock(surface, range, element) {
    range = deleteSelection(surface, range) || caretRange(surface);

    const block = textBlockOf(range.startContainer, surface);
    let unit = block ? topBlockOf(block, surface) : null;

    // Inside a blockquote, insert inside the quote.
    if (block && block.parentNode && block.parentNode.nodeName === 'BLOCKQUOTE') {
        unit = block;
    }

    if (!unit) {
        surface.appendChild(element);
    } else if (block && unit === block && (block.nodeName === 'P' || HEADINGS.has(block.nodeName))) {
        if (isEmptyBlock(block)) {
            block.parentNode.replaceChild(element, block);
        } else if (isAtStart(range, block)) {
            block.parentNode.insertBefore(element, block);
        } else if (isAtEnd(range, block)) {
            insertAfter(element, block);
        } else {
            splitAt(block, range.startContainer, range.startOffset);
            insertAfter(element, block);
        }
    } else {
        insertAfter(element, unit);
    }

    const next = ensureParagraphAfter(element);
    placeCaretAtStart(next);
    ensureStructure(surface);

    return element;
}

export function insertHorizontalRule(surface) {
    const range = caretRange(surface);

    return insertBlock(surface, range, surface.ownerDocument.createElement('hr'));
}

export function clearFormatting(surface, state) {
    const range = getRange(surface);

    if (!range) {
        return false;
    }

    state.pendingMarks.clear();

    const blocks = selectedTextBlocks(surface, range);

    for (const block of blocks) {
        setClasses(block, classList(block).filter((name) => !/^ipx-rte-(text|indent)-/.test(name)));
    }

    if (range.collapsed) {
        return true;
    }

    const texts = isolateTextNodes(range).filter((node) => !closestTag(node, 'PRE', surface));

    for (const node of texts) {
        for (const tag of INLINE_MARKS) {
            removeMark(node, tag, surface);
        }
    }

    if (texts.length) {
        const selection = surface.ownerDocument.createRange();
        selection.setStart(texts[0], 0);
        selection.setEnd(texts[texts.length - 1], texts[texts.length - 1].length);
        insertMarkers(selection);
        cleanupInline(new Set(texts.map((node) => textBlockOf(node, surface)).filter(Boolean)));
        restoreMarkers(surface);
    }

    return true;
}

// ---------------------------------------------------------------------------
// Enter, Shift+Enter and Backspace
// ---------------------------------------------------------------------------

export function insertLineBreak(surface) {
    let range = getRange(surface);

    if (!range) {
        return;
    }

    range = deleteSelection(surface, range);
    const block = textBlockOf(range.startContainer, surface);

    if (block && block.nodeName === 'PRE') {
        insertPreNewline(range, block);
        return;
    }

    const doc = surface.ownerDocument;
    const br = doc.createElement('br');

    range.insertNode(br);

    // A <br> at the end of a block needs a second one to render a line.
    if (block && !hasContentAfter(br, block)) {
        insertAfter(doc.createElement('br'), br);
    }

    const after = doc.createRange();
    after.setStartAfter(br);
    after.collapse(true);
    setRange(after);
}

function hasContentAfter(node, block) {
    let current = node;

    while (current && current !== block) {
        let sibling = current.nextSibling;

        while (sibling) {
            if ((isText(sibling) && sibling.data !== '') || (isElement(sibling) && !LISTS.has(sibling.nodeName))) {
                return true;
            }

            sibling = sibling.nextSibling;
        }

        current = current.parentNode;
    }

    return false;
}

function insertPreNewline(range, pre) {
    const doc = pre.ownerDocument;
    const code = pre.querySelector('code') || pre;

    // Work on a single text node so the caret is a text offset, which
    // every browser keeps (element offsets get re-normalized differently).
    code.normalize();

    let node = code.firstChild && isText(code.firstChild) && code.childNodes.length === 1 ? code.firstChild : null;
    let offset;

    if (node && range.startContainer === node) {
        offset = range.startOffset;
    } else {
        const probe = doc.createRange();
        probe.selectNodeContents(code);
        probe.setEnd(range.startContainer, range.startOffset);
        offset = probe.toString().length;

        const text = code.textContent;
        code.textContent = text;
        node = code.firstChild || code.appendChild(doc.createTextNode(''));
    }

    node.insertData(offset, '\n');

    // A trailing newline does not render; keep one extra so the new empty
    // last line is visible. The serializer trims trailing newlines.
    if (offset + 1 === node.length) {
        node.appendData('\n');
    }

    placeCaret(node, offset + 1);
}

/**
 * Enter: split the current block, continue lists, leave empty list items,
 * blockquotes and code blocks.
 */
export function insertParagraph(surface) {
    const doc = surface.ownerDocument;
    let range = getRange(surface);

    if (!range) {
        return;
    }

    range = deleteSelection(surface, range);
    const block = textBlockOf(range.startContainer, surface);

    if (!block) {
        ensureStructure(surface);
        return;
    }

    if (block.nodeName === 'PRE') {
        // Enter on an empty last line leaves the code block.
        const probe = doc.createRange();
        probe.selectNodeContents(block);
        probe.setEnd(range.startContainer, range.startOffset);

        const before = probe.toString();
        const after = block.textContent.slice(before.length);

        if ((after === '' || after === '\n') && before.endsWith('\n')) {
            const code = block.querySelector('code') || block;
            const remaining = before.replace(/\n$/, '');

            code.textContent = remaining;

            const paragraph = doc.createElement('p');
            paragraph.appendChild(doc.createElement('br'));

            if (remaining === '') {
                block.parentNode.replaceChild(paragraph, block);
            } else {
                insertAfter(paragraph, block);
            }

            placeCaretAtStart(paragraph);

            return;
        }

        insertPreNewline(range, block);

        return;
    }

    if (block.nodeName === 'TD' || block.nodeName === 'TH' || block.nodeName === 'FIGCAPTION') {
        insertLineBreak(surface);
        return;
    }

    if (block.nodeName === 'LI') {
        if (isEmptyBlock(ownInline(block)) && !block.querySelector('ul, ol')) {
            const result = outdentItem(block, surface);
            placeCaretAtStart(result);
            return;
        }

        const right = splitListItem(block, range);
        placeCaretAtStart(right);
        return;
    }

    const quote = block.parentNode && block.parentNode.nodeName === 'BLOCKQUOTE' ? block.parentNode : null;

    if (quote && isEmptyBlock(block)) {
        // Leave the blockquote.
        const after = doc.createElement('blockquote');

        while (block.nextSibling) {
            after.appendChild(block.nextSibling);
        }

        insertAfter(block, quote);

        if (after.firstChild) {
            insertAfter(after, block);
        }

        if (!quote.firstElementChild) {
            quote.remove();
        }

        rename(block, 'p');
        placeCaretAtStart(textBlockOf(range.startContainer, surface) || block);
        return;
    }

    if (HEADINGS.has(block.nodeName) && isAtEnd(range, block)) {
        const paragraph = doc.createElement('p');
        paragraph.appendChild(doc.createElement('br'));
        insertAfter(paragraph, block);
        placeCaretAtStart(paragraph);
        return;
    }

    const atStart = isAtStart(range, block) && !isEmptyBlock(block);

    const right = splitAt(block, range.startContainer, range.startOffset);
    cleanEmptyInline(block);
    cleanEmptyInline(right);
    ensurePlaceholder(block);
    ensurePlaceholder(right);

    // Classes (alignment) carry over; heading split at the start keeps
    // the heading below and leaves an empty paragraph above.
    if (atStart && HEADINGS.has(block.nodeName)) {
        rename(block, 'p');
    }

    placeCaretAtStart(right);
}

function ownInline(item) {
    const clone = item.cloneNode(true);

    for (const list of Array.from(clone.querySelectorAll('ul, ol'))) {
        list.remove();
    }

    return clone;
}

function splitListItem(item, range) {
    const right = splitAt(item, range.startContainer, range.startOffset);

    // Nested lists stay with the new (lower) item.
    cleanEmptyInline(item);
    cleanEmptyInline(right);
    ensurePlaceholderInline(item);
    ensurePlaceholderInline(right);

    return right;
}

function ensurePlaceholderInline(item) {
    const first = item.firstChild;

    if (!first || (isElement(first) && LISTS.has(first.nodeName))) {
        item.insertBefore(item.ownerDocument.createElement('br'), first);
    }
}

function cleanEmptyInline(block) {
    for (const element of Array.from(block.querySelectorAll('strong, em, u, s, code, a'))) {
        if (element.textContent === '' && !element.querySelector('img, br')) {
            element.remove();
        }
    }
}

/**
 * Backspace special cases. Returns true when handled.
 */
export function handleBackspace(surface, range) {
    if (!range.collapsed) {
        return false;
    }

    const block = textBlockOf(range.startContainer, surface);

    if (!block || !isAtStart(range, block)) {
        return false;
    }

    const doc = surface.ownerDocument;

    if (block.nodeName === 'LI') {
        insertMarkers(range);
        outdentItem(block, surface);
        restoreMarkers(surface);

        return true;
    }

    if (block.nodeName === 'TD' || block.nodeName === 'TH') {
        // Never merge table cells.
        return true;
    }

    if (block.parentNode && block.parentNode.nodeName === 'BLOCKQUOTE' && !block.previousElementSibling) {
        const quote = block.parentNode;
        insertMarkers(range);
        quote.parentNode.insertBefore(block, quote);

        if (!quote.firstElementChild) {
            quote.remove();
        }

        restoreMarkers(surface);

        return true;
    }

    if (block.nodeName === 'PRE' && !block.textContent.replace(/\n/g, '')) {
        const paragraph = doc.createElement('p');
        paragraph.appendChild(doc.createElement('br'));
        block.parentNode.replaceChild(paragraph, block);
        placeCaretAtStart(paragraph);

        return true;
    }

    if (HEADINGS.has(block.nodeName) && !block.previousElementSibling && block.parentNode === surface) {
        insertMarkers(range);
        rename(block, 'p');
        restoreMarkers(surface);

        return true;
    }

    const previous = block.previousElementSibling;

    // Backspace after a rule or table removes/selects it instead of merging.
    if (previous && (previous.nodeName === 'HR' || previous.nodeName === 'TABLE' || previous.nodeName === 'FIGURE')) {
        if (previous.nodeName === 'HR') {
            previous.remove();
        } else if (isEmptyBlock(block)) {
            block.remove();
            placeCaretAtEnd(previous.nodeName === 'TABLE' ? previous.querySelector('tr:last-child > :last-child') : previous);
        }

        return true;
    }

    // Keep at least one paragraph in the document.
    if (!previous && block.parentNode === surface && !block.nextElementSibling && isEmptyBlock(block)) {
        if (block.nodeName !== 'P') {
            rename(block, 'p');
            placeCaretAtStart(surface.firstElementChild);
        }

        setClasses(surface.firstElementChild, []);

        return true;
    }

    return false;
}

/**
 * Delete (forward) special cases. Returns true when handled.
 */
export function handleDelete(surface, range) {
    if (!range.collapsed) {
        return false;
    }

    const block = textBlockOf(range.startContainer, surface);

    if (!block || !isAtEnd(range, block)) {
        return false;
    }

    if (block.nodeName === 'TD' || block.nodeName === 'TH') {
        return true;
    }

    const next = block.nextElementSibling;

    if (next && next.nodeName === 'HR') {
        next.remove();

        return true;
    }

    if (next && (next.nodeName === 'TABLE' || next.nodeName === 'FIGURE')) {
        if (isEmptyBlock(block)) {
            block.remove();
            placeCaretAtStart(next.nodeName === 'TABLE' ? next.querySelector('th, td') : next);
        }

        return true;
    }

    return false;
}

export function isCollapsedInside(surface, tag) {
    const range = getRange(surface);

    return !!(range && closestTag(range.startContainer, tag, surface));
}
