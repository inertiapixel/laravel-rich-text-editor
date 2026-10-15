/**
 * Toolbar commands for the Markdown source textarea. They edit the text
 * with setRangeText(); the editor records history afterwards.
 */

export const MARKDOWN_COMMANDS = new Set([
    'undo', 'redo', 'paragraph', 'heading', 'bold', 'italic', 'strikethrough', 'inline_code',
    'bullet_list', 'ordered_list', 'link', 'blockquote', 'code_block', 'horizontal_rule',
    'image', 'file', 'table',
]);

function replace(textarea, start, end, text, selectStart, selectEnd) {
    textarea.focus();
    textarea.setRangeText(text, start, end, 'end');

    if (selectStart !== undefined) {
        textarea.setSelectionRange(selectStart, selectEnd === undefined ? selectStart : selectEnd);
    }
}

/** Wrap the selection (or a placeholder) with inline delimiters, or unwrap. */
export function wrapInline(textarea, delimiter, placeholder = '') {
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    const selected = value.slice(start, end);
    const before = value.slice(Math.max(0, start - delimiter.length), start);
    const after = value.slice(end, end + delimiter.length);

    if (before === delimiter && after === delimiter) {
        replace(textarea, start - delimiter.length, end + delimiter.length, selected, start - delimiter.length, end - delimiter.length);
        return;
    }

    if (selected.startsWith(delimiter) && selected.endsWith(delimiter) && selected.length >= delimiter.length * 2) {
        const inner = selected.slice(delimiter.length, -delimiter.length);
        replace(textarea, start, end, inner, start, start + inner.length);
        return;
    }

    // Keep surrounding whitespace outside the delimiters.
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(selected);
    const content = match[2] || placeholder;
    const text = `${match[1]}${delimiter}${content}${delimiter}${match[3]}`;
    const innerStart = start + match[1].length + delimiter.length;

    replace(textarea, start, end, text, innerStart, innerStart + content.length);
}

export function inlineCode(textarea) {
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    const selected = value.slice(start, end);
    let longest = 0;

    for (const run of selected.match(/`+/g) || []) {
        longest = Math.max(longest, run.length);
    }

    wrapInline(textarea, '`'.repeat(longest + 1));
}

function lineRange(value, start, end) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = value.indexOf('\n', end > start && value[end - 1] === '\n' ? end - 1 : end);

    if (lineEnd === -1) {
        lineEnd = value.length;
    }

    return { lineStart, lineEnd };
}

const BLOCK_PREFIX = /^( {0,3})(#{1,6} |> |[-*+] |\d{1,9}[.)] )?/;

/**
 * Toggle a line prefix ("## ", "> ", "- ", "1. ") on the selected lines.
 * Other block prefixes on those lines are replaced.
 */
export function toggleLinePrefix(textarea, kind) {
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    const { lineStart, lineEnd } = lineRange(value, start, end);
    const lines = value.slice(lineStart, lineEnd).split('\n');
    const prefixFor = (index) => {
        if (kind === 'ordered') {
            return `${index + 1}. `;
        }

        return { quote: '> ', bullet: '- ', paragraph: '' }[kind] ?? kind;
    };

    const matches = (line) => {
        const prefix = BLOCK_PREFIX.exec(line)[2] || '';

        if (kind === 'ordered') {
            return /^\d{1,9}[.)] $/.test(prefix);
        }

        if (kind === 'bullet') {
            return /^[-*+] $/.test(prefix);
        }

        return prefix === prefixFor(0) && prefix !== '';
    };

    const active = lines.filter((line) => line.trim() !== '').every(matches);
    const result = lines.map((line, index) => {
        if (line.trim() === '' && lines.length > 1) {
            return line;
        }

        const stripped = line.replace(BLOCK_PREFIX, '$1');

        return active || kind === 'paragraph' ? stripped : `${stripped.match(/^ */)[0]}${prefixFor(index)}${stripped.replace(/^ */, '')}`;
    }).join('\n');

    replace(textarea, lineStart, lineEnd, result, lineStart, lineStart + result.length);
}

/** Insert a block of Markdown on its own lines (blank lines around it). */
export function insertBlock(textarea, block, selectOffset, selectLength = 0) {
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const leading = before === '' ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const trailing = after === '' ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
    const text = `${leading}${block}${trailing}`;
    const offset = start + leading.length + (selectOffset === undefined ? block.length : selectOffset);

    replace(textarea, start, end, text, offset, offset + selectLength);
}

export function insertInline(textarea, text) {
    const { selectionStart: start, selectionEnd: end } = textarea;

    replace(textarea, start, end, text, start + text.length);
}

export function codeBlock(textarea) {
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    const selected = value.slice(start, end);
    let longest = 0;

    for (const run of selected.match(/`+/g) || []) {
        longest = Math.max(longest, run.length);
    }

    const fence = '`'.repeat(Math.max(3, longest + 1));

    insertBlock(textarea, `${fence}\n${selected}\n${fence}`, fence.length + 1, selected.length);
}

export function tableSkeleton(columns, rows, header) {
    const cell = (label) => label;
    const line = (cells) => `| ${cells.join(' | ')} |`;
    const headerCells = Array.from({ length: columns }, (_, index) => cell(header ? `Column ${index + 1}` : ' '));
    const body = Array.from({ length: Math.max(1, header ? rows - 1 : rows) }, () => line(Array.from({ length: columns }, () => ' ')));

    return [line(headerCells), line(Array.from({ length: columns }, () => '---')), ...body].join('\n');
}

export function selectedText(textarea) {
    return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
}

export function escapeLinkText(text) {
    return text.replace(/([\\[\]])/g, '\\$1');
}

export function markdownUrl(url) {
    return /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url;
}

export function markdownTitle(title) {
    return title ? ` "${title.replace(/(["\\])/g, '\\$1')}"` : '';
}
