/**
 * The serializer/normalizer boundary.
 *
 * Every piece of HTML that enters the editor (initial value, paste, drop,
 * source view) is parsed into an inert document and rebuilt element by
 * element from an allowlist. Nothing from the input is copied verbatim:
 * unknown elements are unwrapped, dangerous ones are dropped with their
 * content, attributes are re-created only when valid, and inline styles
 * are never kept (they may be translated into semantic tags on paste).
 *
 * This runs in the browser and is a usability and safety layer only. The
 * server must sanitize saved HTML again before rendering it.
 */

import {
    BLOCK_TAGS,
    HEADINGS,
    TEXT_BLOCKS,
    classList,
    codePointLength,
    isElement,
    isText,
} from './dom.js';

/** Dropped together with everything inside them. */
const DROP_WITH_CONTENT = new Set([
    'SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED',
    'APPLET', 'SVG', 'MATH', 'TITLE', 'META', 'LINK', 'BASE', 'HEAD', 'CANVAS', 'VIDEO', 'AUDIO',
    'SOURCE', 'TRACK', 'INPUT', 'BUTTON', 'SELECT', 'OPTION', 'OPTGROUP', 'TEXTAREA', 'MAP', 'AREA',
    'DIALOG', 'PARAM', 'XML', 'COLGROUP', 'COL', 'PICTURE', 'PORTAL', 'SLOT', 'MENU', 'DATALIST',
    'OUTPUT', 'PROGRESS', 'METER',
]);

const XHTML = 'http://www.w3.org/1999/xhtml';

/** Elements removed together with their content (including SVG/MathML). */
function isDropped(node) {
    return DROP_WITH_CONTENT.has(node.nodeName.toUpperCase()) || (node.namespaceURI !== null && node.namespaceURI !== XHTML);
}

/** Containers whose children are processed as if they were siblings. */
const TRANSPARENT_BLOCKS = new Set([
    'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'MAIN', 'ADDRESS', 'CENTER',
    'FORM', 'FIELDSET', 'DETAILS', 'SUMMARY', 'DL', 'DT', 'DD', 'FIGURE', 'CAPTION', 'BODY', 'HTML',
    'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'LEGEND', 'HGROUP', 'SEARCH',
]);

const MARK_MAP = {
    STRONG: 'strong', B: 'strong',
    EM: 'em', I: 'em', CITE: 'em', VAR: 'em', DFN: 'em',
    U: 'u', INS: 'u',
    S: 's', STRIKE: 's', DEL: 's',
    CODE: 'code', KBD: 'code', SAMP: 'code', TT: 'code',
};

const ALIGNMENTS = ['left', 'center', 'right', 'justify'];

const IMAGE_ALIGN = ['left', 'center', 'right'];

const VOID = new Set(['BR', 'HR', 'IMG']);

const PROTOCOL = /^([a-z][a-z0-9+.-]*):/i;

const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

/**
 * Build the sanitizer policy from the client configuration.
 */
export function createPolicy(config = {}) {
    const images = config.images || {};
    const tables = config.tables || {};
    const links = config.links || {};
    const headings = (config.headings && config.headings.length ? config.headings : [1, 2, 3, 4, 5, 6]).slice().sort();
    const imageClasses = new Set(Object.keys(images.classes || {}));
    const percentSteps = new Set((images.percentSteps || []).map(Number));
    const presets = new Set(Object.keys(tables.presets || {}));

    return {
        headings,
        maxIndent: config.maxIndent ?? 4,
        links: links.enabled !== false,
        allowNewTab: links.allowNewTab !== false,
        protocols: new Set((links.protocols || ['http', 'https', 'mailto', 'tel']).map((p) => p.toLowerCase())),
        images: images.enabled !== false,
        imageClasses,
        customImageClasses: !!images.customClasses,
        percentSteps,
        maxPixels: images.maxPixels || 4000,
        allowDataImages: !!(config.paste && config.paste.allowDataImages),
        files: !!(config.files && config.files.enabled),
        tables: tables.enabled !== false,
        presets,
    };
}

/** Parse HTML into an inert document. Scripts never run and resources never load. */
export function parseHtml(html) {
    return new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, 'text/html');
}

/** Report of what an import removed, used for lossy-conversion warnings. */
export function createReport() {
    return {
        removedTags: new Set(),
        removedAttributes: new Set(),
        removedClasses: new Set(),
        changed: false,
    };
}

function note(report, kind, value) {
    if (report) {
        report[kind].add(value);
        report.changed = true;
    }
}

/**
 * Sanitize and normalize HTML (or a node's children) into a fragment.
 *
 * Options:
 *  - collapseWhitespace (default true): treat source whitespace like a
 *    browser renders it (paste, initial value, source view).
 *  - mapStyles (default false): translate inline styles from pasted
 *    office/web content into semantic tags. The style itself is dropped.
 */
export function importHtml(input, policy, options = {}) {
    const report = options.report || createReport();
    const source = typeof input === 'string' ? parseHtml(input).body : input;
    const doc = options.document || document;
    const ctx = {
        doc,
        policy,
        report,
        mapStyles: !!options.mapStyles,
        collapse: options.collapseWhitespace !== false,
    };
    const fragment = doc.createDocumentFragment();

    buildBlocks(Array.from(source.childNodes), fragment, ctx);
    finishBlocks(fragment, ctx);

    return { fragment, report };
}

// ---------------------------------------------------------------------------
// Block level
// ---------------------------------------------------------------------------

function buildBlocks(nodes, out, ctx, inheritedClasses = []) {
    let paragraph = null;

    const flush = () => {
        if (paragraph && hasContent(paragraph)) {
            out.appendChild(paragraph);
        }

        paragraph = null;
    };

    for (const node of nodes) {
        if (isText(node) || (isElement(node) && !isBlockish(node))) {
            if (isElement(node) && isDropped(node)) {
                note(ctx.report, 'removedTags', node.nodeName.toLowerCase());
                continue;
            }

            if (isText(node) && !paragraph && /^[\t\n\r\f ]*$/.test(node.data)) {
                continue;
            }

            if (!paragraph) {
                paragraph = ctx.doc.createElement('p');
                applyTextClasses(paragraph, inheritedClasses, ctx, true);
            }

            appendInline(node, paragraph, ctx, new Set());
            continue;
        }

        if (!isElement(node)) {
            continue;
        }

        flush();
        buildBlock(node, out, ctx, inheritedClasses);
    }

    flush();
}

function isBlockish(node) {
    return BLOCK_TAGS.has(node.nodeName);
}

function buildBlock(node, out, ctx, inheritedClasses) {
    const tag = node.nodeName;

    if (isDropped(node)) {
        note(ctx.report, 'removedTags', tag.toLowerCase());
        return;
    }

    if (tag === 'P' || HEADINGS.has(tag)) {
        if (containsBlocks(node)) {
            buildBlocks(Array.from(node.childNodes), out, ctx, sourceTextClasses(node));
            return;
        }

        const block = ctx.doc.createElement(tag === 'P' ? 'p' : mapHeading(tag, ctx));
        applyTextClasses(block, sourceTextClasses(node).concat(inheritedClasses), ctx, true, node);
        appendInlineChildren(node, block, ctx);

        if (hasContent(block) || tag === 'P') {
            out.appendChild(block);
        }

        return;
    }

    if (tag === 'BLOCKQUOTE') {
        const quote = ctx.doc.createElement('blockquote');
        buildBlocks(Array.from(node.childNodes), quote, ctx);
        finishBlocks(quote, ctx);

        if (quote.childNodes.length) {
            out.appendChild(quote);
        }

        return;
    }

    if (tag === 'UL' || tag === 'OL') {
        const list = buildList(node, ctx);

        if (list) {
            out.appendChild(list);
        }

        return;
    }

    if (tag === 'LI') {
        const list = ctx.doc.createElement('ul');
        list.appendChild(buildListItem(node, ctx));
        out.appendChild(list);
        return;
    }

    if (tag === 'PRE') {
        out.appendChild(buildCodeBlock(node, ctx));
        return;
    }

    if (tag === 'HR') {
        out.appendChild(ctx.doc.createElement('hr'));
        return;
    }

    if (tag === 'TABLE') {
        if (ctx.policy.tables) {
            const table = buildTable(node, ctx);

            if (table) {
                out.appendChild(table);
            }
        } else {
            note(ctx.report, 'removedTags', 'table');
            tableToParagraphs(node, out, ctx);
        }

        return;
    }

    if (tag === 'FIGURE' && node.querySelector('img')) {
        buildFigure(node, out, ctx);
        return;
    }

    if (tag === 'FIGCAPTION') {
        const paragraph = ctx.doc.createElement('p');
        appendInlineChildren(node, paragraph, ctx);

        if (hasContent(paragraph)) {
            out.appendChild(paragraph);
        }

        return;
    }

    if (TRANSPARENT_BLOCKS.has(tag) || BLOCK_TAGS.has(tag)) {
        const classes = sourceTextClasses(node).concat(inheritedClasses);

        if (containsBlocks(node)) {
            buildBlocks(Array.from(node.childNodes), out, ctx, classes);
            return;
        }

        const paragraph = ctx.doc.createElement('p');
        applyTextClasses(paragraph, classes, ctx, true, node);
        appendInlineChildren(node, paragraph, ctx);

        if (hasContent(paragraph)) {
            out.appendChild(paragraph);
        }

        return;
    }

    // Unknown elements are unwrapped.
    buildBlocks(Array.from(node.childNodes), out, ctx, inheritedClasses);
}

function containsBlocks(node) {
    for (const child of node.childNodes) {
        if (isElement(child) && BLOCK_TAGS.has(child.nodeName)) {
            return true;
        }

        if (isElement(child) && !isDropped(child) && containsBlocks(child)) {
            return true;
        }
    }

    return false;
}

function mapHeading(tag, ctx) {
    const level = Number(tag.slice(1));
    const allowed = ctx.policy.headings;

    if (allowed.includes(level)) {
        return `h${level}`;
    }

    note(ctx.report, 'removedTags', tag.toLowerCase());

    if (!allowed.length) {
        return 'p';
    }

    // Nearest allowed level, preferring the deeper one on ties.
    let best = allowed[0];

    for (const candidate of allowed) {
        if (Math.abs(candidate - level) <= Math.abs(best - level)) {
            best = candidate;
        }
    }

    return `h${best}`;
}

function sourceTextClasses(node) {
    const classes = [];

    for (const name of classList(node)) {
        if (/^ipx-rte-(text|indent)-/.test(name)) {
            classes.push(name);
        }
    }

    // Legacy alignment from pasted or older content (never kept as a style).
    const align = (node.getAttribute('align') || '').toLowerCase();

    if (ALIGNMENTS.includes(align)) {
        classes.push(`ipx-rte-text-${align}`);
    }

    return classes;
}

function applyTextClasses(block, classes, ctx, allowIndent, source) {
    const kept = [];
    let alignment = null;
    let indent = null;

    for (const name of classes) {
        const align = /^ipx-rte-text-(left|center|right|justify)$/.exec(name);

        if (align) {
            alignment = alignment || name;
            continue;
        }

        const level = /^ipx-rte-indent-(\d)$/.exec(name);

        if (level && allowIndent && Number(level[1]) >= 1 && Number(level[1]) <= ctx.policy.maxIndent) {
            indent = indent || name;
            continue;
        }

        note(ctx.report, 'removedClasses', name);
    }

    if (source) {
        for (const name of classList(source)) {
            if (!/^ipx-rte-(text|indent)-/.test(name)) {
                note(ctx.report, 'removedClasses', name);
            }
        }

        reportAttributes(source, ['class', 'align'], ctx);
    }

    if (alignment) {
        kept.push(alignment);
    }

    if (indent) {
        kept.push(indent);
    }

    if (kept.length) {
        block.setAttribute('class', kept.join(' '));
    }
}

function reportAttributes(source, allowed, ctx) {
    for (const attribute of Array.from(source.attributes || [])) {
        if (!allowed.includes(attribute.name)) {
            note(ctx.report, 'removedAttributes', attribute.name);
        }
    }
}

function buildList(node, ctx) {
    const list = ctx.doc.createElement(node.nodeName === 'OL' ? 'ol' : 'ul');

    if (node.nodeName === 'OL') {
        const start = node.getAttribute('start');

        if (start !== null && /^\d{1,9}$/.test(start.trim()) && Number(start) !== 1) {
            list.setAttribute('start', String(Number(start)));
        }

        reportAttributes(node, ['start'], ctx);
    } else {
        reportAttributes(node, [], ctx);
    }

    let loose = null;

    for (const child of Array.from(node.childNodes)) {
        if (isElement(child) && child.nodeName === 'LI') {
            loose = null;
            list.appendChild(buildListItem(child, ctx));
        } else if (isElement(child) && (child.nodeName === 'UL' || child.nodeName === 'OL')) {
            // <ul><li>a</li><ul>...</ul></ul>: attach to the previous item.
            const nested = buildList(child, ctx);

            if (nested) {
                const previous = list.lastElementChild || list.appendChild(ctx.doc.createElement('li'));
                previous.appendChild(nested);
            }
        } else if (isText(child) && /^[\t\n\r\f ]*$/.test(child.data)) {
            continue;
        } else if (isElement(child) && isDropped(child)) {
            note(ctx.report, 'removedTags', child.nodeName.toLowerCase());
        } else {
            if (!loose) {
                loose = ctx.doc.createElement('li');
                list.appendChild(loose);
            }

            appendFlattened(child, loose, ctx);
        }
    }

    for (const item of Array.from(list.children)) {
        finishInline(item, ctx);
    }

    return list.children.length ? list : null;
}

function buildListItem(node, ctx) {
    const item = ctx.doc.createElement('li');
    const nestedLists = [];

    applyTextClasses(item, sourceTextClasses(node), ctx, false, node);

    for (const child of Array.from(node.childNodes)) {
        if (isElement(child) && (child.nodeName === 'UL' || child.nodeName === 'OL')) {
            const nested = buildList(child, ctx);

            if (nested) {
                nestedLists.push(nested);
            }

            continue;
        }

        appendFlattened(child, item, ctx);
    }

    finishInline(item, ctx);

    for (const nested of nestedLists) {
        item.appendChild(nested);
    }

    return item;
}

/**
 * Append a node to an inline container, flattening block content into
 * inline content separated by line breaks (list items and table cells hold
 * inline content only).
 */
function appendFlattened(node, target, ctx) {
    if (!isElement(node) || !BLOCK_TAGS.has(node.nodeName)) {
        appendInline(node, target, ctx, new Set());
        return;
    }

    if (isDropped(node)) {
        note(ctx.report, 'removedTags', node.nodeName.toLowerCase());
        return;
    }

    if (node.nodeName === 'UL' || node.nodeName === 'OL' || node.nodeName === 'TABLE' || node.nodeName === 'PRE' || node.nodeName === 'BLOCKQUOTE' || HEADINGS.has(node.nodeName)) {
        note(ctx.report, 'removedTags', node.nodeName.toLowerCase());
    }

    const holder = ctx.doc.createElement('span');

    if (node.nodeName === 'PRE') {
        holder.appendChild(ctx.doc.createTextNode(preText(node)));
    } else if (node.nodeName === 'HR') {
        return;
    } else {
        for (const child of Array.from(node.childNodes)) {
            appendFlattened(child, holder, ctx);
        }
    }

    if (!hasContent(holder)) {
        return;
    }

    if (hasContent(target) && !endsWithBreak(target)) {
        target.appendChild(ctx.doc.createElement('br'));
    }

    while (holder.firstChild) {
        target.appendChild(holder.firstChild);
    }
}

function endsWithBreak(node) {
    let last = node.lastChild;

    while (last && isText(last) && /^[\t\n\r\f ]*$/.test(last.data)) {
        last = last.previousSibling;
    }

    return !!last && last.nodeName === 'BR';
}

function buildCodeBlock(node, ctx) {
    const pre = ctx.doc.createElement('pre');
    const code = ctx.doc.createElement('code');
    const language = codeLanguage(node);

    if (language) {
        code.setAttribute('class', `language-${language}`);
    }

    let text = preText(node);

    // Like the HTML parser, ignore one leading newline. Trailing newlines
    // never render (the editor adds one to show an empty last line).
    text = text.replace(/^\n/, '').replace(/\n+$/, '');
    code.appendChild(ctx.doc.createTextNode(text));
    pre.appendChild(code);

    if (node.querySelector && node.querySelector('*:not(code):not(br):not(span)')) {
        ctx.report.changed = true;
    }

    return pre;
}

function codeLanguage(node) {
    const candidates = [node, ...(node.querySelectorAll ? Array.from(node.querySelectorAll('code')) : [])];

    for (const candidate of candidates) {
        for (const name of classList(candidate)) {
            const match = /^(?:language|lang)-([A-Za-z0-9_+#.-]{1,30})$/.exec(name);

            if (match) {
                return match[1];
            }
        }
    }

    return null;
}

function preText(node) {
    let text = '';

    const walk = (current) => {
        for (const child of current.childNodes) {
            if (isText(child)) {
                text += child.data;
            } else if (isElement(child)) {
                if (child.nodeName === 'BR') {
                    text += '\n';
                } else if (!isDropped(child)) {
                    walk(child);

                    if (BLOCK_TAGS.has(child.nodeName) && !text.endsWith('\n')) {
                        text += '\n';
                    }
                }
            }
        }
    };

    walk(node);

    return text.replace(/\r\n?/g, '\n').replace(/[\u200B\uFEFF]/g, '');
}

function buildFigure(node, out, ctx) {
    const image = node.querySelector('img');
    const caption = node.querySelector('figcaption');
    const cleanImage = buildImage(image, ctx);

    if (!cleanImage) {
        if (caption) {
            const paragraph = ctx.doc.createElement('p');
            appendInlineChildren(caption, paragraph, ctx);

            if (hasContent(paragraph)) {
                out.appendChild(paragraph);
            }
        }

        return;
    }

    const figure = ctx.doc.createElement('figure');
    const figureClasses = ['ipx-rte-figure'];

    // Layout classes (alignment and width) live on the figure.
    for (const name of classList(node).concat(classList(image))) {
        if (/^ipx-rte-img-(left|center|right)$/.test(name) || /^ipx-rte-w-\d+$/.test(name)) {
            if (isAllowedImageClass(name, ctx) && !figureClasses.includes(name)) {
                figureClasses.push(name);
            }
        }
    }

    const imageClasses = classList(cleanImage).filter((name) => !/^ipx-rte-img-(left|center|right)$/.test(name) && !/^ipx-rte-w-\d+$/.test(name) && name !== 'ipx-rte-img--block');

    if (imageClasses.length) {
        cleanImage.setAttribute('class', imageClasses.join(' '));
    } else {
        cleanImage.removeAttribute('class');
    }

    figure.setAttribute('class', figureClasses.join(' '));
    figure.appendChild(cleanImage);

    if (caption) {
        const cleanCaption = ctx.doc.createElement('figcaption');
        appendInlineChildren(caption, cleanCaption, ctx);

        if (hasContent(cleanCaption)) {
            figure.appendChild(cleanCaption);
        }
    }

    out.appendChild(figure);
}

function buildTable(node, ctx) {
    const rows = [];
    let headerRows = 0;

    const collect = (container, isHead) => {
        for (const child of Array.from(container.children)) {
            if (child.nodeName === 'TR') {
                rows.push(child);

                if (isHead) {
                    headerRows += 1;
                }
            } else if (child.nodeName === 'THEAD') {
                collect(child, rows.length === 0);
            } else if (child.nodeName === 'TBODY' || child.nodeName === 'TFOOT') {
                collect(child, false);
            } else if (child.nodeName === 'CAPTION') {
                note(ctx.report, 'removedTags', 'caption');
            }
        }
    };

    collect(node, false);

    if (!rows.length) {
        return null;
    }

    // Expand colspan/rowspan into a rectangular grid of cells.
    const grid = [];

    rows.forEach((row, rowIndex) => {
        grid[rowIndex] = grid[rowIndex] || [];
        let column = 0;

        for (const cell of Array.from(row.children)) {
            if (cell.nodeName !== 'TD' && cell.nodeName !== 'TH') {
                continue;
            }

            while (grid[rowIndex][column]) {
                column += 1;
            }

            const colspan = clampSpan(cell.getAttribute('colspan'));
            const rowspan = clampSpan(cell.getAttribute('rowspan'));

            if (colspan > 1 || rowspan > 1) {
                note(ctx.report, 'removedAttributes', colspan > 1 ? 'colspan' : 'rowspan');
            }

            for (let r = 0; r < rowspan && rowIndex + r < rows.length; r += 1) {
                grid[rowIndex + r] = grid[rowIndex + r] || [];

                for (let c = 0; c < colspan; c += 1) {
                    grid[rowIndex + r][column + c] = r === 0 && c === 0 ? { source: cell } : { source: null, header: cell.nodeName === 'TH' };
                }
            }

            column += colspan;
        }
    });

    const width = Math.max(1, ...grid.map((row) => row.length));

    if (headerRows === 0 && grid[0] && grid[0].every((cell) => cell && (cell.source ? cell.source.nodeName === 'TH' : cell.header))) {
        headerRows = 1;
    }

    headerRows = Math.min(headerRows, 1);

    const table = ctx.doc.createElement('table');
    const classes = ['ipx-rte-table'];

    for (const name of classList(node)) {
        const preset = /^ipx-rte-table--([a-z0-9-]+)$/.exec(name);

        if (preset && ctx.policy.presets.has(preset[1])) {
            classes.push(name);
        } else if (name !== 'ipx-rte-table') {
            note(ctx.report, 'removedClasses', name);
        }
    }

    table.setAttribute('class', classes.join(' '));
    reportAttributes(node, ['class'], ctx);

    const makeRow = (cells, header) => {
        const tr = ctx.doc.createElement('tr');

        for (let column = 0; column < width; column += 1) {
            const entry = cells[column];
            const sourceTag = entry && entry.source ? entry.source.nodeName : null;
            const cell = ctx.doc.createElement(header || sourceTag === 'TH' ? 'th' : 'td');

            if (header) {
                cell.setAttribute('scope', 'col');
            }

            if (entry && entry.source) {
                const align = cellAlignment(entry.source);

                if (align) {
                    cell.setAttribute('class', align);
                }

                for (const child of Array.from(entry.source.childNodes)) {
                    appendFlattened(child, cell, ctx);
                }

                finishInline(cell, ctx);
            }

            tr.appendChild(cell);
        }

        return tr;
    };

    if (headerRows) {
        const thead = ctx.doc.createElement('thead');
        thead.appendChild(makeRow(grid[0], true));
        table.appendChild(thead);
    }

    const tbody = ctx.doc.createElement('tbody');

    for (let index = headerRows; index < grid.length; index += 1) {
        tbody.appendChild(makeRow(grid[index] || [], false));
    }

    if (tbody.children.length || !headerRows) {
        if (!tbody.children.length) {
            tbody.appendChild(makeRow([], false));
        }

        table.appendChild(tbody);
    }

    return table;
}

function clampSpan(value) {
    const number = Number.parseInt(value || '1', 10);

    return Number.isFinite(number) && number > 1 ? Math.min(number, 50) : 1;
}

function cellAlignment(cell) {
    for (const name of classList(cell)) {
        if (/^ipx-rte-text-(left|center|right|justify)$/.test(name)) {
            return name;
        }
    }

    const align = (cell.getAttribute('align') || '').toLowerCase();

    return ALIGNMENTS.includes(align) ? `ipx-rte-text-${align}` : null;
}

function tableToParagraphs(node, out, ctx) {
    for (const row of Array.from(node.querySelectorAll('tr'))) {
        const paragraph = ctx.doc.createElement('p');
        let first = true;

        for (const cell of Array.from(row.children)) {
            if (!first) {
                paragraph.appendChild(ctx.doc.createTextNode(' \u2022 '));
            }

            first = false;
            appendInlineChildren(cell, paragraph, ctx);
        }

        finishInline(paragraph, ctx);

        if (hasContent(paragraph)) {
            out.appendChild(paragraph);
        }
    }
}

// ---------------------------------------------------------------------------
// Inline level
// ---------------------------------------------------------------------------

function appendInlineChildren(node, target, ctx) {
    for (const child of Array.from(node.childNodes)) {
        appendFlattened(child, target, ctx);
    }

    finishInline(target, ctx);
}

function appendInline(node, target, ctx, marks) {
    if (isText(node)) {
        const text = node.data.replace(/[\u200B\uFEFF]/g, '');

        if (text) {
            target.appendChild(ctx.doc.createTextNode(text));
        }

        return;
    }

    if (!isElement(node)) {
        return;
    }

    const tag = node.nodeName;

    if (isDropped(node)) {
        note(ctx.report, 'removedTags', tag.toLowerCase());
        return;
    }

    if (tag === 'BR') {
        target.appendChild(ctx.doc.createElement('br'));
        return;
    }

    if (tag === 'IMG') {
        const image = buildImage(node, ctx);

        if (image) {
            target.appendChild(image);
        }

        return;
    }

    if (BLOCK_TAGS.has(tag)) {
        appendFlattened(node, target, ctx);
        return;
    }

    if (tag === 'A') {
        const link = buildLink(node, ctx, marks);

        if (link) {
            target.appendChild(link);
            return;
        }

        appendChildrenInline(node, target, ctx, marks);
        return;
    }

    let mark = MARK_MAP[tag] || null;

    // Google Docs wraps documents in <b style="font-weight:normal">.
    if (tag === 'B' && /font-weight\s*:\s*(normal|[1-5]00)\b/i.test(node.getAttribute('style') || '')) {
        mark = null;
    }

    if (mark) {
        if (marks.has(mark)) {
            appendChildrenInline(node, target, ctx, marks);
            return;
        }

        const element = ctx.doc.createElement(mark);
        const nextMarks = new Set(marks).add(mark);
        reportAttributes(node, [], ctx);
        appendChildrenInline(node, element, ctx, nextMarks);

        if (hasContent(element)) {
            target.appendChild(element);
        }

        return;
    }

    // Unknown inline elements (span, font, small, sub, ...) are unwrapped:
    // their text is kept, the element and its attributes are not.
    note(ctx.report, 'removedTags', tag.toLowerCase());

    // Spans and other wrappers: translate pasted styles, then unwrap.
    if (ctx.mapStyles) {
        const styled = styleMarks(node.getAttribute('style') || '').filter((name) => !marks.has(name));

        if (styled.length) {
            let outer = null;
            let inner = null;

            for (const name of styled) {
                const element = ctx.doc.createElement(name);

                if (inner) {
                    inner.appendChild(element);
                } else {
                    outer = element;
                }

                inner = element;
            }

            appendChildrenInline(node, inner, ctx, new Set([...marks, ...styled]));

            if (hasContent(outer)) {
                target.appendChild(outer);
            }

            return;
        }
    }

    appendChildrenInline(node, target, ctx, marks);
}

function appendChildrenInline(node, target, ctx, marks) {
    for (const child of Array.from(node.childNodes)) {
        appendInline(child, target, ctx, marks);
    }
}

function styleMarks(style) {
    const marks = [];
    const declarations = style.toLowerCase();

    if (/font-weight\s*:\s*(bold|bolder|[6-9]00)\b/.test(declarations)) {
        marks.push('strong');
    }

    if (/font-style\s*:\s*italic\b/.test(declarations)) {
        marks.push('em');
    }

    if (/text-decoration(?:-line)?\s*:[^;]*underline/.test(declarations)) {
        marks.push('u');
    }

    if (/text-decoration(?:-line)?\s*:[^;]*line-through/.test(declarations)) {
        marks.push('s');
    }

    return marks;
}

function buildLink(node, ctx, marks) {
    if (marks.has('a')) {
        return null;
    }

    const href = safeUrl(node.getAttribute('href'), ctx.policy.protocols, false);
    const isAttachment = classList(node).includes('ipx-rte-attachment') && ctx.policy.files;

    if (!href || (!ctx.policy.links && !isAttachment)) {
        if (node.hasAttribute('href')) {
            note(ctx.report, 'removedAttributes', 'href');
        }

        return null;
    }

    const link = ctx.doc.createElement('a');
    link.setAttribute('href', href);

    const title = cleanText(node.getAttribute('title'));

    if (title) {
        link.setAttribute('title', title);
    }

    if (isAttachment) {
        link.setAttribute('class', 'ipx-rte-attachment');
    }

    if (node.getAttribute('target') === '_blank' && ctx.policy.allowNewTab) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
    } else if (node.hasAttribute('target')) {
        note(ctx.report, 'removedAttributes', 'target');
    }

    reportAttributes(node, ['href', 'title', 'target', 'rel', 'class'], ctx);

    for (const name of classList(node)) {
        if (name !== 'ipx-rte-attachment') {
            note(ctx.report, 'removedClasses', name);
        }
    }

    appendChildrenInline(node, link, ctx, new Set([...marks, 'a']));

    return hasContent(link) ? link : null;
}

/** Percentages that have matching classes in the content stylesheet. */
export const SUPPORTED_PERCENTS = [5, 10, 15, 20, 25, 30, 33, 35, 40, 45, 50, 55, 60, 65, 66, 70, 75, 80, 85, 90, 95, 100];

export function isAllowedImageClass(name, ctx) {
    const policy = ctx.policy || ctx;
    const size = /^ipx-rte-[wh]-(\d+)$/.exec(name);

    // Any supported size class is kept, even when the current
    // configuration offers fewer steps, so existing content survives.
    if (size) {
        return SUPPORTED_PERCENTS.includes(Number(size[1]));
    }

    if (/^ipx-rte-img-(left|center|right)$/.test(name) || name === 'ipx-rte-img--block' || name === 'ipx-rte-img--inline') {
        return true;
    }

    if (policy.imageClasses.has(name)) {
        return true;
    }

    return policy.customImageClasses && isCustomClass(name);
}

export function isCustomClass(name) {
    return /^-?[A-Za-z_][A-Za-z0-9_\-:/.[\]%]*$/.test(name) && name.length <= 100 && !name.startsWith('ipx-rte');
}

function buildImage(node, ctx) {
    if (!ctx.policy.images) {
        note(ctx.report, 'removedTags', 'img');
        return null;
    }

    const src = safeImageUrl(node.getAttribute('src'), ctx.policy);

    if (!src) {
        note(ctx.report, 'removedTags', 'img');
        return null;
    }

    const image = ctx.doc.createElement('img');
    image.setAttribute('src', src);
    image.setAttribute('alt', cleanText(node.getAttribute('alt')) || '');

    const title = cleanText(node.getAttribute('title'));

    if (title) {
        image.setAttribute('title', title);
    }

    for (const dimension of ['width', 'height']) {
        const value = (node.getAttribute(dimension) || '').trim();

        if (/^\d{1,5}$/.test(value) && Number(value) > 0 && Number(value) <= ctx.policy.maxPixels) {
            image.setAttribute(dimension, String(Number(value)));
        } else if (value) {
            note(ctx.report, 'removedAttributes', dimension);
        }
    }

    const classes = [];

    for (const name of classList(node)) {
        if (isAllowedImageClass(name, ctx)) {
            classes.push(name);
        } else {
            note(ctx.report, 'removedClasses', name);
        }
    }

    if (classes.length) {
        image.setAttribute('class', Array.from(new Set(classes)).join(' '));
    }

    reportAttributes(node, ['src', 'alt', 'title', 'width', 'height', 'class'], ctx);

    return image;
}

function cleanText(value) {
    return (value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}

/**
 * Return the URL when it is relative or uses an allowed protocol.
 */
export function safeUrl(value, protocols, allowData) {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    if (!trimmed || trimmed.length > 2048) {
        return null;
    }

    // Browsers ignore control characters and whitespace inside schemes
    // ("java\tscript:"), so the check must ignore them too.
    const compact = trimmed.replace(/[\u0000- \u007F-\u009F]/g, '');
    const match = PROTOCOL.exec(compact);

    if (!match) {
        return /^[\\]/.test(compact) ? null : trimmed;
    }

    const protocol = match[1].toLowerCase();

    if (protocol === 'data') {
        return allowData && DATA_IMAGE.test(compact) ? compact : null;
    }

    return protocols.has(protocol) ? trimmed : null;
}

function safeImageUrl(value, policy) {
    return safeUrl(value, new Set(['http', 'https']), policy.allowDataImages);
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

function hasContent(node) {
    if (!node) {
        return false;
    }

    if (node.querySelector && node.querySelector('img, br, hr')) {
        return true;
    }

    return node.textContent.replace(/[\u200B\uFEFF]/g, '') !== '';
}

/** Merge marks, drop empty wrappers and collapse whitespace in a text block. */
function finishInline(block, ctx) {
    removeEmptyInline(block);
    mergeAdjacentMarks(block);
    block.normalize();

    if (ctx.collapse) {
        collapseWhitespace(block);
    }

    removeEmptyInline(block);
}

function finishBlocks(container, ctx) {
    for (const block of Array.from(container.children)) {
        if (TEXT_BLOCKS.has(block.nodeName) && block.nodeName !== 'PRE') {
            finishInline(block, ctx);

            if (block.nodeName === 'P' && !hasContent(block)) {
                block.remove();
            }
        }
    }
}

function removeEmptyInline(node) {
    for (const child of Array.from(node.childNodes)) {
        if (!isElement(child) || VOID.has(child.nodeName) || BLOCK_TAGS.has(child.nodeName)) {
            continue;
        }

        removeEmptyInline(child);

        if (!hasContent(child)) {
            child.remove();
        }
    }
}

function sameAttributes(a, b) {
    if (a.attributes.length !== b.attributes.length) {
        return false;
    }

    for (const attribute of Array.from(a.attributes)) {
        if (b.getAttribute(attribute.name) !== attribute.value) {
            return false;
        }
    }

    return true;
}

export function mergeAdjacentMarks(node) {
    let child = node.firstChild;

    while (child) {
        const next = child.nextSibling;

        if (isElement(child) && next && isElement(next) && child.nodeName === next.nodeName
            && !VOID.has(child.nodeName) && !BLOCK_TAGS.has(child.nodeName) && sameAttributes(child, next)) {
            while (next.firstChild) {
                child.appendChild(next.firstChild);
            }

            next.remove();
            continue;
        }

        if (isElement(child) && !VOID.has(child.nodeName) && !BLOCK_TAGS.has(child.nodeName)) {
            mergeAdjacentMarks(child);
        }

        child = next;
    }
}

/**
 * Collapse ASCII whitespace like CSS "white-space: normal": runs become a
 * single space, and spaces at the start/end of a line are removed.
 * Non-breaking spaces are kept.
 */
export function collapseWhitespace(block) {
    const texts = [];
    const walker = block.ownerDocument.createTreeWalker(block, 5 /* elements + text */);
    let previousWasSpace = true;
    let node = walker.nextNode();

    while (node) {
        if (isText(node)) {
            let data = node.data.replace(/[\t\n\r\f ]+/g, ' ');

            if (previousWasSpace && data.startsWith(' ')) {
                data = data.slice(1);
            }

            if (data !== node.data) {
                node.data = data;
            }

            if (data) {
                previousWasSpace = data.endsWith(' ');
                texts.push(node);
            }
        } else if (node.nodeName === 'BR') {
            trimTrailing(texts);
            previousWasSpace = true;
        } else if (node.nodeName === 'IMG') {
            previousWasSpace = false;
            texts.length = 0;
        }

        node = walker.nextNode();
    }

    trimTrailing(texts);

    for (const text of Array.from(block.querySelectorAll('*'))) {
        for (const child of Array.from(text.childNodes)) {
            if (isText(child) && child.data === '') {
                child.remove();
            }
        }
    }

    for (const child of Array.from(block.childNodes)) {
        if (isText(child) && child.data === '') {
            child.remove();
        }
    }
}

function trimTrailing(texts) {
    for (let index = texts.length - 1; index >= 0; index -= 1) {
        const text = texts[index];
        const trimmed = text.data.replace(/ +$/, '');

        if (trimmed !== text.data) {
            text.data = trimmed;
        }

        if (trimmed) {
            break;
        }
    }

    texts.length = 0;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

const INDENTED_CONTAINERS = new Set(['UL', 'OL', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'FIGURE']);

function escapeText(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00A0/g, '&nbsp;');
}

function escapeAttribute(text) {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00A0/g, '&nbsp;');
}

function openTag(node) {
    let html = `<${node.nodeName.toLowerCase()}`;

    for (const attribute of Array.from(node.attributes)) {
        html += attribute.value === '' && attribute.name !== 'alt'
            ? ` ${attribute.name}`
            : ` ${attribute.name}="${escapeAttribute(attribute.value)}"`;
    }

    return `${html}>`;
}

function serializeInline(node) {
    let html = '';

    for (const child of node.childNodes) {
        if (isText(child)) {
            html += escapeText(child.data);
        } else if (isElement(child)) {
            if (VOID.has(child.nodeName)) {
                html += openTag(child);
            } else if (BLOCK_TAGS.has(child.nodeName)) {
                html += serializeNode(child, '', false);
            } else {
                html += `${openTag(child)}${serializeInline(child)}</${child.nodeName.toLowerCase()}>`;
            }
        }
    }

    return html;
}

function serializeNode(node, indent, pretty) {
    const tag = node.nodeName.toLowerCase();
    const newline = pretty ? '\n' : '';
    const step = pretty ? '  ' : '';

    if (VOID.has(node.nodeName)) {
        return `${indent}${openTag(node)}`;
    }

    if (node.nodeName === 'PRE') {
        const code = node.querySelector('code');
        const inner = code ? `${openTag(code)}${escapeText(code.textContent)}</code>` : escapeText(node.textContent);

        return `${indent}${openTag(node)}${inner}</pre>`;
    }

    if (INDENTED_CONTAINERS.has(node.nodeName) || (node.nodeName === 'LI' && node.querySelector(':scope > ul, :scope > ol'))) {
        const parts = [];
        let inline = '';

        for (const child of node.childNodes) {
            if (isElement(child) && BLOCK_TAGS.has(child.nodeName)) {
                if (inline) {
                    parts.push({ inline });
                    inline = '';
                }

                parts.push({ block: child });
            } else if (isText(child)) {
                inline += escapeText(child.data);
            } else if (isElement(child)) {
                inline += VOID.has(child.nodeName) ? openTag(child) : `${openTag(child)}${serializeInline(child)}</${child.nodeName.toLowerCase()}>`;
            }
        }

        if (inline) {
            parts.push({ inline });
        }

        let html = `${indent}${openTag(node)}`;
        let first = true;

        for (const part of parts) {
            if (part.inline !== undefined) {
                html += first ? part.inline : `${newline}${indent}${step}${part.inline}`;
            } else {
                html += `${newline}${serializeNode(part.block, indent + step, pretty)}`;
            }

            first = false;
        }

        return `${html}${parts.some((part) => part.block) ? `${newline}${indent}` : ''}</${tag}>`;
    }

    return `${indent}${openTag(node)}${serializeInline(node)}</${tag}>`;
}

/**
 * Serialize a clean tree. Leading/trailing empty paragraphs are trimmed and
 * an empty document serializes to an empty string.
 */
export function serializeHtml(root, options = {}) {
    const pretty = options.pretty !== false;
    const blocks = Array.from(root.childNodes).filter((node) => isElement(node));

    while (blocks.length && isEmptyParagraph(blocks[0])) {
        blocks.shift();
    }

    while (blocks.length && isEmptyParagraph(blocks[blocks.length - 1])) {
        blocks.pop();
    }

    return blocks.map((block) => serializeNode(stripBogusBreaks(block), '', pretty)).join(pretty ? '\n' : '');
}

function isEmptyParagraph(node) {
    return node.nodeName === 'P' && node.textContent.replace(/[\u200B\uFEFF\s]/g, '') === '' && !node.querySelector('img');
}

/** Remove the invisible trailing <br> browsers leave at the end of blocks. */
function stripBogusBreaks(block) {
    const clone = block.cloneNode(true);
    const targets = TEXT_BLOCKS.has(clone.nodeName) ? [clone] : [];

    targets.push(...Array.from(clone.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, figcaption')));

    for (const target of targets) {
        let last = target.lastChild;

        while (last && isElement(last) && (last.nodeName === 'UL' || last.nodeName === 'OL')) {
            last = last.previousSibling;
        }

        if (last && last.nodeName === 'BR') {
            const before = last.previousSibling;

            // "text<br>" renders like "text"; "text<br><br>" does not. Empty
            // paragraphs and list items keep their <br> so they still render.
            if (before ? before.nodeName !== 'BR' : (target.nodeName === 'TD' || target.nodeName === 'TH')) {
                last.remove();
            }
        }
    }

    return clone;
}

// ---------------------------------------------------------------------------
// Visible text and counting
// ---------------------------------------------------------------------------

/**
 * Extract the user-visible text of a clean tree.
 *
 * Contract (mirrored by VisibleText.php, covered by shared fixtures):
 *  1. Block elements and <br> are line breaks. Text in <pre> keeps its
 *     whitespace and its newlines are line breaks.
 *  2. Elsewhere, runs of ASCII whitespace become one space, and each line
 *     is trimmed of ASCII spaces. Non-breaking spaces are kept.
 *  3. Empty lines are removed; lines are joined with "\n".
 *  4. Images and other embedded content contribute nothing.
 */
export function extractText(root) {
    const lines = [];
    let current = { text: '', pre: false };

    const lineBreak = () => {
        lines.push(current);
        current = { text: '', pre: false };
    };

    const walk = (node, pre) => {
        for (const child of node.childNodes) {
            if (isText(child)) {
                const data = child.data.replace(/[\u200B\uFEFF]/g, '');

                if (pre) {
                    const parts = data.replace(/\r\n?/g, '\n').split('\n');

                    parts.forEach((part, index) => {
                        if (index > 0) {
                            lineBreak();
                        }

                        current.pre = true;
                        current.text += part;
                    });
                } else {
                    current.text += data.replace(/[\t\n\r\f ]+/g, ' ');
                }

                continue;
            }

            if (!isElement(child) || isDropped(child)) {
                continue;
            }

            if (child.nodeName === 'BR') {
                lineBreak();
                continue;
            }

            const block = BLOCK_TAGS.has(child.nodeName);

            if (block) {
                lineBreak();
            }

            walk(child, pre || child.nodeName === 'PRE');

            if (block) {
                lineBreak();
            }
        }
    };

    walk(root, false);
    lines.push(current);

    return lines
        .map((line) => (line.pre ? line.text : line.text.replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '')))
        .filter((line) => line !== '')
        .join('\n');
}

/** Visible characters: code points of the extracted text, without line breaks. */
export function countVisibleCharacters(root) {
    return codePointLength(extractText(root).replace(/\n/g, ''));
}

export function countWords(text) {
    const trimmed = text.trim();

    return trimmed ? trimmed.split(/\s+/u).length : 0;
}
