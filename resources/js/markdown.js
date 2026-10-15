/**
 * Markdown <-> DOM conversion for a documented subset:
 *
 *   paragraphs, ATX and setext headings, emphasis (* _), strong (** __),
 *   strikethrough (~~), inline code, links, images, autolinks (<url>),
 *   backslash escapes, hard line breaks, bullet and ordered lists
 *   (nested), blockquotes, fenced and indented code blocks, thematic
 *   breaks and GFM pipe tables.
 *
 * Not supported: raw HTML (always shown as text), reference links,
 * footnotes, HTML entities (shown literally) and task lists. This is not a
 * full CommonMark implementation.
 *
 * Parsing builds DOM nodes with createElement/createTextNode only; the
 * result is passed through the sanitizer before it is shown.
 */

import { BLOCK_TAGS, classList, isElement, isText } from './dom.js';

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/;
const HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const BULLET = /^( {0,3})([-+*])(?:([ \t]+)(.*)|$)$/;
const ORDERED = /^( {0,3})(\d{1,9})([.)])(?:([ \t]+)(.*)|$)$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const BLANK = /^[ \t]*$/;

function expandTabs(line) {
    if (!line.includes('\t')) {
        return line;
    }

    let result = '';

    for (const char of line) {
        result += char === '\t' ? ' '.repeat(4 - (result.length % 4)) : char;
    }

    return result;
}

function leadingSpaces(line) {
    return /^ */.exec(line)[0].length;
}

function stripIndent(line, count) {
    let index = 0;

    while (index < count && line[index] === ' ') {
        index += 1;
    }

    return line.slice(index);
}

function listMarker(line) {
    if (HR.test(line)) {
        return null;
    }

    let match = BULLET.exec(line);

    if (match) {
        const spaces = match[3] ? match[3].length : 1;
        const width = match[1].length + 1 + (spaces > 4 ? 1 : spaces);

        return { ordered: false, char: match[2], indent: match[1].length, width, content: match[3] && spaces > 4 ? ' '.repeat(spaces - 1) + (match[4] || '') : (match[4] || ''), start: 1 };
    }

    match = ORDERED.exec(line);

    if (match) {
        const spaces = match[4] ? match[4].length : 1;
        const markerLength = match[2].length + 1;
        const width = match[1].length + markerLength + (spaces > 4 ? 1 : spaces);

        return { ordered: true, char: match[3], indent: match[1].length, width, content: match[4] && spaces > 4 ? ' '.repeat(spaces - 1) + (match[5] || '') : (match[5] || ''), start: Number(match[2]) };
    }

    return null;
}

function startsBlock(line, ctx, inParagraph) {
    if (BLANK.test(line)) {
        return true;
    }

    if (FENCE.test(line) || ATX.test(line) || HR.test(line) || QUOTE.test(line)) {
        return true;
    }

    const marker = listMarker(line);

    // A list may interrupt a paragraph only when the item is non-empty
    // and (for ordered lists) starts at 1.
    if (marker && (!inParagraph || (marker.content.trim() !== '' && (!marker.ordered || marker.start === 1)))) {
        return true;
    }

    return false;
}

function splitRow(line) {
    let row = line.trim();

    if (row.startsWith('|')) {
        row = row.slice(1);
    }

    if (row.endsWith('|') && !row.endsWith('\\|')) {
        row = row.slice(0, -1);
    }

    const cells = [];
    let current = '';
    let inCode = 0;

    for (let index = 0; index < row.length; index += 1) {
        const char = row[index];

        if (char === '\\' && row[index + 1] === '|') {
            current += '|';
            index += 1;
            continue;
        }

        if (char === '`') {
            let run = 1;

            while (row[index + run] === '`') {
                run += 1;
            }

            inCode = inCode === run ? 0 : (inCode || run);
            current += '`'.repeat(run);
            index += run - 1;
            continue;
        }

        if (char === '|' && !inCode) {
            cells.push(current.trim());
            current = '';
            continue;
        }

        current += char;
    }

    cells.push(current.trim());

    return cells;
}

function parseBlocks(lines, ctx, out) {
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];

        if (BLANK.test(line)) {
            index += 1;
            continue;
        }

        // Fenced code block.
        let match = FENCE.exec(line);

        if (match && !(match[2][0] === '`' && match[3].includes('`'))) {
            const indent = match[1].length;
            const fence = match[2];
            const body = [];
            index += 1;

            while (index < lines.length) {
                const closing = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);

                if (closing.test(lines[index])) {
                    index += 1;
                    break;
                }

                body.push(stripIndent(lines[index], indent));
                index += 1;
            }

            out.appendChild(codeBlock(ctx, body.join('\n'), match[3]));
            continue;
        }

        match = ATX.exec(line);

        if (match) {
            const text = match[2].replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trim();
            const heading = ctx.doc.createElement(`h${match[1].length}`);
            parseInline(text, heading, ctx);
            out.appendChild(heading);
            index += 1;
            continue;
        }

        if (HR.test(line)) {
            out.appendChild(ctx.doc.createElement('hr'));
            index += 1;
            continue;
        }

        if (QUOTE.test(line)) {
            const body = [];
            let lazyAllowed = false;

            while (index < lines.length) {
                const quoted = QUOTE.exec(lines[index]);

                if (quoted) {
                    body.push(quoted[1]);
                    lazyAllowed = !BLANK.test(quoted[1]) && !FENCE.test(quoted[1]);
                    index += 1;
                } else if (lazyAllowed && !startsBlock(lines[index], ctx, true)) {
                    body.push(lines[index]);
                    index += 1;
                } else {
                    break;
                }
            }

            const quote = ctx.doc.createElement('blockquote');
            parseBlocks(body, ctx, quote);
            out.appendChild(quote);
            continue;
        }

        const marker = listMarker(line);

        if (marker) {
            index = parseList(lines, index, marker, ctx, out);
            continue;
        }

        // Indented code block (cannot interrupt a paragraph).
        if (leadingSpaces(line) >= 4) {
            const body = [];

            while (index < lines.length && (leadingSpaces(lines[index]) >= 4 || BLANK.test(lines[index]))) {
                body.push(stripIndent(lines[index], 4));
                index += 1;
            }

            while (body.length && BLANK.test(body[body.length - 1])) {
                body.pop();
            }

            out.appendChild(codeBlock(ctx, body.join('\n'), ''));
            continue;
        }

        // GFM table: header row followed by a delimiter row.
        if (ctx.tables && line.includes('|') && index + 1 < lines.length && TABLE_DELIMITER.test(lines[index + 1])) {
            const header = splitRow(line);
            const delimiter = splitRow(lines[index + 1]);

            if (header.length === delimiter.length) {
                index = parseTable(lines, index, header, delimiter, ctx, out);
                continue;
            }
        }

        // Paragraph (with setext heading detection).
        const paragraph = [line];
        index += 1;
        let setext = 0;

        while (index < lines.length) {
            const next = lines[index];
            const underline = SETEXT.exec(next);

            if (underline) {
                setext = underline[1][0] === '=' ? 1 : 2;
                index += 1;
                break;
            }

            if (startsBlock(next, ctx, true)) {
                break;
            }

            if (ctx.tables && next.includes('|') && index + 1 < lines.length && TABLE_DELIMITER.test(lines[index + 1])) {
                break;
            }

            paragraph.push(next);
            index += 1;
        }

        const element = ctx.doc.createElement(setext ? `h${setext}` : 'p');
        parseInline(paragraph.map((text) => text.replace(/^[ \t]+/, '')).join('\n').replace(/[ \t]+$/, ''), element, ctx);
        out.appendChild(element);
    }
}

function codeBlock(ctx, text, info) {
    const pre = ctx.doc.createElement('pre');
    const code = ctx.doc.createElement('code');
    const language = (info || '').replace(/\\(.)/g, '$1');

    if (/^[A-Za-z0-9_+#.-]{1,30}$/.test(language)) {
        code.setAttribute('class', `language-${language}`);
    }

    code.textContent = text;
    pre.appendChild(code);

    return pre;
}

/**
 * Lists. Item content is parsed recursively; paragraphs inside an item are
 * unwrapped (separated by <br>) because list items hold inline content
 * plus nested lists in this editor, so tight and loose lists produce the
 * same document.
 */
function parseList(lines, index, first, ctx, out) {
    const list = ctx.doc.createElement(first.ordered ? 'ol' : 'ul');

    if (first.ordered && first.start !== 1) {
        list.setAttribute('start', String(first.start));
    }

    let marker = first;

    while (marker && marker.ordered === first.ordered && marker.char === first.char) {
        const body = [marker.content];
        const width = marker.width;
        let previousBlank = false;
        index += 1;

        while (index < lines.length) {
            const line = lines[index];

            if (BLANK.test(line)) {
                body.push('');
                previousBlank = true;
                index += 1;
                continue;
            }

            if (leadingSpaces(line) >= width) {
                body.push(stripIndent(line, width));
                previousBlank = false;
                index += 1;
                continue;
            }

            // A list marker that is not indented enough starts a sibling
            // item (or another list); it is never a lazy continuation.
            if (listMarker(line)) {
                break;
            }

            // Lazy paragraph continuation.
            if (!previousBlank && !startsBlock(line, ctx, true) && !BLANK.test(body[body.length - 1])) {
                body.push(line);
                index += 1;
                continue;
            }

            break;
        }

        const holder = ctx.doc.createElement('div');
        parseBlocks(body, ctx, holder);

        const li = ctx.doc.createElement('li');

        for (const child of Array.from(holder.childNodes)) {
            if (child.nodeName === 'P') {
                if (li.childNodes.length && li.lastChild.nodeName !== 'UL' && li.lastChild.nodeName !== 'OL') {
                    li.appendChild(ctx.doc.createElement('br'));
                }

                while (child.firstChild) {
                    li.appendChild(child.firstChild);
                }
            } else {
                li.appendChild(child);
            }
        }

        list.appendChild(li);

        marker = index < lines.length ? listMarker(lines[index]) : null;
    }

    out.appendChild(list);

    return index;
}

function parseTable(lines, index, header, delimiter, ctx, out) {
    const alignments = delimiter.map((cell) => {
        const left = cell.startsWith(':');
        const right = cell.endsWith(':');

        if (left && right) {
            return 'center';
        }

        if (right) {
            return 'right';
        }

        return left ? 'left' : null;
    });

    const table = ctx.doc.createElement('table');
    table.setAttribute('class', 'ipx-rte-table');

    const makeRow = (cells, tag) => {
        const tr = ctx.doc.createElement('tr');

        for (let column = 0; column < header.length; column += 1) {
            const cell = ctx.doc.createElement(tag);

            if (tag === 'th') {
                cell.setAttribute('scope', 'col');
            }

            if (alignments[column]) {
                cell.setAttribute('class', `ipx-rte-text-${alignments[column]}`);
            }

            parseInline(cells[column] || '', cell, ctx);
            tr.appendChild(cell);
        }

        return tr;
    };

    const thead = ctx.doc.createElement('thead');
    thead.appendChild(makeRow(header, 'th'));
    table.appendChild(thead);

    const tbody = ctx.doc.createElement('tbody');
    index += 2;

    while (index < lines.length && !BLANK.test(lines[index]) && !(startsBlock(lines[index], ctx, true) && !lines[index].includes('|'))) {
        tbody.appendChild(makeRow(splitRow(lines[index]), 'td'));
        index += 1;
    }

    if (tbody.children.length) {
        table.appendChild(tbody);
    }

    out.appendChild(table);

    return index;
}

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

const PUNCTUATION = /[!-/:-@[-`{-~\p{P}\p{S}]/u;
const ESCAPABLE = /[!-/:-@[-`{-~]/;
const WHITESPACE = /\s/u;

function isPunctuation(char) {
    return !!char && PUNCTUATION.test(char);
}

function isWhitespace(char) {
    return !char || WHITESPACE.test(char);
}

function parseInline(text, target, ctx) {
    const nodes = tokenizeInline(text, ctx, false);
    processEmphasis(nodes, 0);
    appendNodes(nodes, target, ctx);
}

/**
 * Turn inline source into a flat list of nodes:
 * { type: 'text' | 'code' | 'br' | 'link' | 'image' | 'delim' | ... }
 */
function tokenizeInline(text, ctx, inLink) {
    const nodes = [];
    let buffer = '';
    let index = 0;

    const flush = () => {
        if (buffer) {
            nodes.push({ type: 'text', value: buffer });
            buffer = '';
        }
    };

    while (index < text.length) {
        const char = text[index];

        if (char === '\\') {
            const next = text[index + 1];

            if (next === '\n') {
                flush();
                nodes.push({ type: 'br' });
                index += 2;
                continue;
            }

            if (next && ESCAPABLE.test(next)) {
                buffer += next;
                index += 2;
                continue;
            }

            buffer += char;
            index += 1;
            continue;
        }

        if (char === '\n') {
            // Two or more trailing spaces make a hard break.
            if (/ {2,}$/.test(buffer)) {
                buffer = buffer.replace(/ +$/, '');
                flush();
                nodes.push({ type: 'br' });
            } else {
                buffer = buffer.replace(/ +$/, '');
                buffer += '\n';
            }

            index += 1;

            while (text[index] === ' ') {
                index += 1;
            }

            continue;
        }

        if (char === '`') {
            let run = 1;

            while (text[index + run] === '`') {
                run += 1;
            }

            const closing = findBacktickRun(text, index + run, run);

            if (closing === -1) {
                buffer += '`'.repeat(run);
                index += run;
                continue;
            }

            flush();
            let code = text.slice(index + run, closing).replace(/\n/g, ' ');

            if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') {
                code = code.slice(1, -1);
            }

            nodes.push({ type: 'code', value: code });
            index = closing + run;
            continue;
        }

        if (char === '<') {
            const autolink = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/.exec(text.slice(index))
                || /^<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/.exec(text.slice(index));

            if (autolink && !inLink) {
                flush();
                const target = autolink[1].includes('@') && !autolink[1].includes(':') ? `mailto:${autolink[1]}` : autolink[1];
                nodes.push({ type: 'link', href: target, title: '', children: [{ type: 'text', value: autolink[1] }] });
                index += autolink[0].length;
                continue;
            }
        }

        if (char === '!' && text[index + 1] === '[') {
            const link = parseLinkAt(text, index + 1, ctx);

            if (link) {
                flush();
                nodes.push({ type: 'image', src: link.destination, title: link.title, alt: plainText(link.label) });
                index = link.end;
                continue;
            }
        }

        if (char === '[' && !inLink) {
            const link = parseLinkAt(text, index, ctx);

            if (link) {
                flush();
                const children = tokenizeInline(link.label, ctx, true);
                processEmphasis(children, 0);
                nodes.push({ type: 'link', href: link.destination, title: link.title, children });
                index = link.end;
                continue;
            }
        }

        if (char === '*' || char === '_' || char === '~') {
            let run = 1;

            while (text[index + run] === char) {
                run += 1;
            }

            if (char === '~' && run !== 2) {
                buffer += char.repeat(run);
                index += run;
                continue;
            }

            flush();

            const before = index > 0 ? text[index - 1] : '';
            const after = text[index + run] || '';
            const leftFlanking = !isWhitespace(after) && (!isPunctuation(after) || isWhitespace(before) || isPunctuation(before));
            const rightFlanking = !isWhitespace(before) && (!isPunctuation(before) || isWhitespace(after) || isPunctuation(after));
            let canOpen = leftFlanking;
            let canClose = rightFlanking;

            if (char === '_') {
                canOpen = leftFlanking && (!rightFlanking || isPunctuation(before));
                canClose = rightFlanking && (!leftFlanking || isPunctuation(after));
            }

            nodes.push({ type: 'delim', char, count: run, original: run, canOpen, canClose });
            index += run;
            continue;
        }

        buffer += char;
        index += 1;
    }

    flush();

    return nodes;
}

function findBacktickRun(text, from, length) {
    let index = from;

    while (index < text.length) {
        if (text[index] === '`') {
            let run = 1;

            while (text[index + run] === '`') {
                run += 1;
            }

            if (run === length) {
                return index;
            }

            index += run;
        } else {
            index += 1;
        }
    }

    return -1;
}

/**
 * Parse "[label](destination "title")" starting at the "[" at `start`.
 */
function parseLinkAt(text, start) {
    let depth = 0;
    let index = start;

    for (; index < text.length; index += 1) {
        const char = text[index];

        if (char === '\\') {
            index += 1;
            continue;
        }

        if (char === '`') {
            let run = 1;

            while (text[index + run] === '`') {
                run += 1;
            }

            const closing = findBacktickRun(text, index + run, run);

            if (closing !== -1) {
                index = closing + run - 1;
                continue;
            }
        }

        if (char === '[') {
            depth += 1;
        } else if (char === ']') {
            depth -= 1;

            if (depth === 0) {
                break;
            }
        }
    }

    if (depth !== 0 || text[index + 1] !== '(') {
        return null;
    }

    const label = text.slice(start + 1, index);
    let position = index + 2;

    while (/[ \t\n]/.test(text[position] || '')) {
        position += 1;
    }

    let destination = '';

    if (text[position] === '<') {
        const close = text.indexOf('>', position);

        if (close === -1 || text.slice(position, close).includes('\n')) {
            return null;
        }

        destination = text.slice(position + 1, close);
        position = close + 1;
    } else {
        let parens = 0;

        while (position < text.length) {
            const char = text[position];

            if (char === '\\' && ESCAPABLE.test(text[position + 1] || '')) {
                destination += text[position + 1];
                position += 2;
                continue;
            }

            if (/\s/.test(char)) {
                break;
            }

            if (char === '(') {
                parens += 1;
            } else if (char === ')') {
                if (parens === 0) {
                    break;
                }

                parens -= 1;
            }

            destination += char;
            position += 1;
        }
    }

    while (/[ \t\n]/.test(text[position] || '')) {
        position += 1;
    }

    let title = '';
    const opener = text[position];

    if (opener === '"' || opener === "'" || opener === '(') {
        const closer = opener === '(' ? ')' : opener;
        let end = position + 1;

        while (end < text.length && text[end] !== closer) {
            end += text[end] === '\\' ? 2 : 1;
        }

        if (end >= text.length) {
            return null;
        }

        title = text.slice(position + 1, end).replace(/\\([!-/:-@[-`{-~])/g, '$1');
        position = end + 1;

        while (/[ \t\n]/.test(text[position] || '')) {
            position += 1;
        }
    }

    if (text[position] !== ')') {
        return null;
    }

    return { label, destination, title, end: position + 1 };
}

function plainText(markdown) {
    const nodes = tokenizeInline(markdown, {}, true);
    processEmphasis(nodes, 0);

    const collect = (list) => list.map((node) => {
        if (node.type === 'text' || node.type === 'code') {
            return node.value;
        }

        if (node.type === 'delim') {
            return node.char.repeat(node.count);
        }

        if (node.type === 'image') {
            return node.alt;
        }

        return node.children ? collect(node.children) : '';
    }).join('');

    return collect(nodes).replace(/\n/g, ' ');
}

/**
 * CommonMark "process emphasis": match closers with openers and replace
 * the nodes in between with emphasis containers.
 */
function processEmphasis(nodes) {
    let closerIndex = 0;

    while (closerIndex < nodes.length) {
        const closer = nodes[closerIndex];

        if (closer.type !== 'delim' || !closer.canClose || closer.count === 0) {
            closerIndex += 1;
            continue;
        }

        let openerIndex = closerIndex - 1;
        let found = false;

        while (openerIndex >= 0) {
            const opener = nodes[openerIndex];

            if (opener.type === 'delim' && opener.char === closer.char && opener.canOpen && opener.count > 0) {
                const oddMatch = (opener.canClose || closer.canOpen)
                    && (opener.original + closer.original) % 3 === 0
                    && !(opener.original % 3 === 0 && closer.original % 3 === 0);

                const tildeMismatch = closer.char === '~' && (opener.count !== 2 || closer.count !== 2);

                if (!oddMatch && !tildeMismatch) {
                    found = true;
                    break;
                }
            }

            openerIndex -= 1;
        }

        if (!found) {
            if (!closer.canOpen) {
                closer.canClose = false;
            }

            closerIndex += 1;
            continue;
        }

        const opener = nodes[openerIndex];
        const use = closer.char === '~' ? 2 : (opener.count >= 2 && closer.count >= 2 ? 2 : 1);
        const type = closer.char === '~' ? 's' : (use === 2 ? 'strong' : 'em');
        const inner = nodes.slice(openerIndex + 1, closerIndex);

        // Delimiters between opener and closer can no longer match.
        for (const node of inner) {
            if (node.type === 'delim') {
                node.canOpen = false;
                node.canClose = false;
            }
        }

        opener.count -= use;
        closer.count -= use;

        const container = { type, children: inner };
        nodes.splice(openerIndex + 1, closerIndex - openerIndex - 1, container);
        closerIndex = openerIndex + 2;

        if (opener.count === 0) {
            nodes.splice(openerIndex, 1);
            closerIndex -= 1;
        }

        if (closer.count === 0) {
            nodes.splice(closerIndex, 1);
        }
    }
}

function appendNodes(nodes, target, ctx) {
    for (const node of nodes) {
        switch (node.type) {
            case 'text':
                target.appendChild(ctx.doc.createTextNode(node.value));
                break;
            case 'delim':
                if (node.count > 0) {
                    target.appendChild(ctx.doc.createTextNode(node.char.repeat(node.count)));
                }

                break;
            case 'code': {
                const code = ctx.doc.createElement('code');
                code.textContent = node.value;
                target.appendChild(code);
                break;
            }
            case 'br':
                target.appendChild(ctx.doc.createElement('br'));
                break;
            case 'link': {
                const link = ctx.doc.createElement('a');
                link.setAttribute('href', node.href);

                if (node.title) {
                    link.setAttribute('title', node.title);
                }

                appendNodes(node.children, link, ctx);
                target.appendChild(link);
                break;
            }
            case 'image': {
                const image = ctx.doc.createElement('img');
                image.setAttribute('src', node.src);
                image.setAttribute('alt', node.alt);

                if (node.title) {
                    image.setAttribute('title', node.title);
                }

                target.appendChild(image);
                break;
            }
            default: {
                const element = ctx.doc.createElement(node.type);
                appendNodes(node.children, element, ctx);
                target.appendChild(element);
            }
        }
    }
}

/**
 * Parse Markdown into a (not yet sanitized) document fragment.
 */
export function markdownToFragment(markdown, options = {}) {
    const doc = options.document || document;
    const ctx = { doc, tables: options.tables !== false };
    const fragment = doc.createDocumentFragment();
    const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n').map(expandTabs);

    parseBlocks(lines, ctx, fragment);

    return fragment;
}

// ---------------------------------------------------------------------------
// Serialization (clean DOM -> Markdown)
// ---------------------------------------------------------------------------

function escapeInline(text, inTable) {
    const escaped = text
        .replace(/\\/g, '\\\\')
        .replace(/([`*_[\]<~])/g, '\\$1')
        .replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&');

    return inTable ? escaped.replace(/\|/g, '\\|') : escaped;
}

/** Escape characters that would start a block at the beginning of a line. */
function escapeLineStart(line) {
    return line
        .replace(/^(\s*)([#>+=-])/, '$1\\$2')
        .replace(/^(\s*)(\d{1,9})([.)])/, '$1$2\\$3');
}

function longestRun(text, char) {
    let longest = 0;
    let current = 0;

    for (const value of text) {
        current = value === char ? current + 1 : 0;
        longest = Math.max(longest, current);
    }

    return longest;
}

function serializeUrl(url) {
    if (/[\s()<>]/.test(url)) {
        return `<${url.replace(/[<>]/g, (char) => encodeURIComponent(char))}>`;
    }

    return url.replace(/\\/g, '\\\\');
}

function serializeTitle(title) {
    return title ? ` "${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : '';
}

function inlineMarkdown(node, inTable) {
    let output = '';

    for (const child of node.childNodes) {
        if (isText(child)) {
            output += escapeInline(child.data, inTable);
            continue;
        }

        if (!isElement(child)) {
            continue;
        }

        const tag = child.nodeName;

        if (tag === 'BR') {
            output += inTable ? ' ' : '\\\n';
            continue;
        }

        if (tag === 'IMG') {
            const alt = (child.getAttribute('alt') || '').replace(/\\/g, '\\\\').replace(/([[\]])/g, '\\$1');
            output += `![${alt}](${serializeUrl(child.getAttribute('src') || '')}${serializeTitle(child.getAttribute('title') || '')})`;
            continue;
        }

        if (tag === 'CODE') {
            const text = child.textContent;
            const fence = '`'.repeat(longestRun(text, '`') + 1);
            const pad = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '') ? ' ' : '';
            output += `${fence}${pad}${text}${pad}${fence}`;
            continue;
        }

        if (tag === 'A') {
            output += `[${inlineMarkdown(child, inTable)}](${serializeUrl(child.getAttribute('href') || '')}${serializeTitle(child.getAttribute('title') || '')})`;
            continue;
        }

        const delimiter = { STRONG: '**', EM: '*', S: '~~' }[tag];
        const inner = inlineMarkdown(child, inTable);

        if (!delimiter) {
            // <u> and anything else without a Markdown equivalent.
            output += inner;
            continue;
        }

        // Keep surrounding whitespace outside the delimiters so they flank.
        const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);

        if (!match[2]) {
            output += inner;
            continue;
        }

        output += `${match[1]}${delimiter}${match[2]}${delimiter}${match[3]}`;
    }

    return output;
}

function inlineBlock(node, inTable) {
    return inlineMarkdown(node, inTable)
        .split('\n')
        .map((line, index) => (index === 0 && inTable ? line : escapeLineStart(line)))
        .join('\n');
}

function indentLines(text, prefix, firstPrefix) {
    return text.split('\n').map((line, index) => {
        if (index === 0) {
            return firstPrefix + line;
        }

        return line === '' ? '' : prefix + line;
    }).join('\n');
}

function blocksMarkdown(container) {
    const parts = [];

    for (const child of container.childNodes) {
        if (!isElement(child)) {
            continue;
        }

        const markdown = blockMarkdown(child);

        if (markdown !== null) {
            parts.push(markdown);
        }
    }

    return parts.join('\n\n');
}

function blockMarkdown(node) {
    const tag = node.nodeName;

    if (tag === 'P') {
        return inlineBlock(node);
    }

    if (/^H[1-6]$/.test(tag)) {
        // Headings are single-line; a trailing "#" would read as a closing sequence.
        const text = inlineMarkdown(node).replace(/\\\n/g, ' ').replace(/\n/g, ' ').replace(/#$/, '\\#');

        return `${'#'.repeat(Number(tag[1]))} ${text}`.trimEnd();
    }

    if (tag === 'BLOCKQUOTE') {
        return blocksMarkdown(node).split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
    }

    if (tag === 'UL' || tag === 'OL') {
        return listMarkdown(node);
    }

    if (tag === 'PRE') {
        const code = node.querySelector('code');
        const text = (code || node).textContent;
        const language = code ? (classList(code).find((name) => name.startsWith('language-')) || '').slice(9) : '';
        const fence = '`'.repeat(Math.max(3, longestRun(text, '`') + 1));

        return `${fence}${language}\n${text.replace(/\n$/, '')}\n${fence}`;
    }

    if (tag === 'HR') {
        return '---';
    }

    if (tag === 'TABLE') {
        return tableMarkdown(node);
    }

    if (tag === 'FIGURE') {
        const parts = [];
        const image = node.querySelector('img');
        const caption = node.querySelector('figcaption');

        if (image) {
            const holder = node.ownerDocument.createElement('p');
            holder.appendChild(image.cloneNode(true));
            parts.push(inlineBlock(holder));
        }

        if (caption) {
            parts.push(inlineBlock(caption));
        }

        return parts.join('\n\n');
    }

    if (BLOCK_TAGS.has(tag)) {
        return inlineBlock(node);
    }

    return null;
}

function listMarkdown(list) {
    const ordered = list.nodeName === 'OL';
    let number = ordered ? Number(list.getAttribute('start') || 1) : 0;
    const items = [];

    for (const item of list.children) {
        if (item.nodeName !== 'LI') {
            continue;
        }

        const marker = ordered ? `${number}. ` : '- ';
        const padding = ' '.repeat(marker.length);
        number += 1;

        const inlineHolder = item.ownerDocument.createElement('p');
        const nested = [];

        for (const child of item.childNodes) {
            if (isElement(child) && (child.nodeName === 'UL' || child.nodeName === 'OL')) {
                nested.push(listMarkdown(child));
            } else {
                inlineHolder.appendChild(child.cloneNode(true));
            }
        }

        let text = inlineBlock(inlineHolder);

        for (const sub of nested) {
            text += `\n${sub}`;
        }

        items.push(indentLines(text, padding, marker));
    }

    return items.join('\n');
}

function tableMarkdown(table) {
    const rows = Array.from(table.querySelectorAll('tr'));

    if (!rows.length) {
        return '';
    }

    const width = Math.max(...rows.map((row) => row.children.length));
    const cellText = (cell) => (cell ? inlineMarkdown(cell, true).replace(/\n/g, ' ').trim() : '');
    const alignment = (cell) => {
        const name = cell ? classList(cell).find((value) => /^ipx-rte-text-(left|center|right)$/.test(value)) : null;

        return name ? name.slice('ipx-rte-text-'.length) : null;
    };

    const line = (row) => {
        const cells = [];

        for (let column = 0; column < width; column += 1) {
            cells.push(cellText(row.children[column]));
        }

        return `| ${cells.join(' | ')} |`;
    };

    const header = rows[0];
    const delimiter = [];

    for (let column = 0; column < width; column += 1) {
        const align = alignment(header.children[column]) || alignment(rows[1] && rows[1].children[column]);
        delimiter.push(align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---');
    }

    return [line(header), `| ${delimiter.join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

/**
 * Serialize a clean tree to Markdown.
 */
export function fragmentToMarkdown(root) {
    return blocksMarkdown(root).replace(/^\n+|\n+$/g, '');
}

/**
 * Features of a clean tree that Markdown cannot represent, as reason keys
 * for the lossy-conversion warning.
 */
export function markdownLossReasons(root) {
    const reasons = new Set();

    if (root.querySelector('u')) {
        reasons.add('loss_underline');
    }

    if (root.querySelector('[class*="ipx-rte-text-"]:not(td):not(th)')) {
        reasons.add('loss_alignment');
    }

    if (root.querySelector('[class*="ipx-rte-indent-"]')) {
        reasons.add('loss_indent');
    }

    if (root.querySelector('img[class], img[width], img[height], figure')) {
        reasons.add('loss_image_options');
    }

    if (root.querySelector('table[class*="ipx-rte-table--"]')) {
        reasons.add('loss_table_design');
    }

    for (const table of root.querySelectorAll('table')) {
        if (!table.querySelector('thead') || table.querySelector('td br, th br, td img, th img')) {
            reasons.add('loss_table_structure');
        }
    }

    if (root.querySelector('a[target]')) {
        reasons.add('loss_link_target');
    }

    if (root.querySelector('a.ipx-rte-attachment')) {
        reasons.add('loss_attachments');
    }

    return reasons;
}
