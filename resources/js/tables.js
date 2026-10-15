/**
 * Table creation and editing. Tables always keep a valid structure:
 * an optional <thead> with one row of <th scope="col"> and a <tbody>, every
 * row holding the same number of cells. Designs are classes only.
 */

import { closestTag, rename } from './dom.js';
import { placeCaretAtEnd, placeCaretAtStart } from './selection.js';

function cell(doc, tag) {
    const element = doc.createElement(tag);

    if (tag === 'th') {
        element.setAttribute('scope', 'col');
    }

    element.appendChild(doc.createElement('br'));

    return element;
}

export function presetClasses(presets) {
    return ['ipx-rte-table', ...presets.map((preset) => `ipx-rte-table--${preset}`)].join(' ');
}

export function createTable(doc, rows, columns, { header = true, presets = [] } = {}) {
    const table = doc.createElement('table');
    table.setAttribute('class', presetClasses(presets));

    if (header) {
        const thead = doc.createElement('thead');
        const row = doc.createElement('tr');

        for (let column = 0; column < columns; column += 1) {
            row.appendChild(cell(doc, 'th'));
        }

        thead.appendChild(row);
        table.appendChild(thead);
    }

    const tbody = doc.createElement('tbody');
    const bodyRows = Math.max(1, header ? rows - 1 : rows);

    for (let index = 0; index < bodyRows; index += 1) {
        const row = doc.createElement('tr');

        for (let column = 0; column < columns; column += 1) {
            row.appendChild(cell(doc, 'td'));
        }

        tbody.appendChild(row);
    }

    table.appendChild(tbody);

    return table;
}

export function tableContext(surface, range) {
    if (!range) {
        return null;
    }

    const current = closestTag(range.startContainer, new Set(['TD', 'TH']), surface);

    if (!current) {
        return null;
    }

    const table = current.closest('table');
    const row = current.parentNode;

    return {
        table,
        row,
        cell: current,
        rowIndex: Array.prototype.indexOf.call(table.rows, row),
        columnIndex: Array.prototype.indexOf.call(row.cells, current),
    };
}

function body(table) {
    let tbody = table.tBodies[0];

    if (!tbody) {
        tbody = table.ownerDocument.createElement('tbody');
        table.appendChild(tbody);
    }

    return tbody;
}

export function addRow(context, after) {
    const { table, row } = context;
    const doc = table.ownerDocument;
    const width = row.cells.length;
    const fresh = doc.createElement('tr');

    for (let column = 0; column < width; column += 1) {
        fresh.appendChild(cell(doc, 'td'));
    }

    if (row.parentNode.nodeName === 'THEAD') {
        const tbody = body(table);
        tbody.insertBefore(fresh, tbody.firstChild);
    } else if (after) {
        row.parentNode.insertBefore(fresh, row.nextSibling);
    } else {
        row.parentNode.insertBefore(fresh, row);
    }

    placeCaretAtStart(fresh.cells[Math.min(context.columnIndex, width - 1)]);

    return fresh;
}

export function deleteRow(surface, context) {
    const { table, row, columnIndex } = context;

    if (table.rows.length <= 1) {
        return deleteTable(surface, context);
    }

    const section = row.parentNode;
    const index = Array.prototype.indexOf.call(table.rows, row);

    row.remove();

    if (!section.rows.length) {
        section.remove();
    }

    if (!table.tBodies.length) {
        body(table);
    }

    const target = table.rows[Math.min(index, table.rows.length - 1)];

    placeCaretAtStart(target.cells[Math.min(columnIndex, target.cells.length - 1)]);

    return true;
}

export function addColumn(context, after) {
    const { table, columnIndex } = context;
    const doc = table.ownerDocument;
    const index = after ? columnIndex + 1 : columnIndex;

    for (const row of Array.from(table.rows)) {
        const tag = row.parentNode.nodeName === 'THEAD' ? 'th' : 'td';
        const reference = row.cells[index] || null;
        row.insertBefore(cell(doc, tag), reference);
    }

    placeCaretAtStart(context.row.cells[index]);

    return true;
}

export function deleteColumn(surface, context) {
    const { table, columnIndex, row } = context;

    if (row.cells.length <= 1) {
        return deleteTable(surface, context);
    }

    for (const current of Array.from(table.rows)) {
        if (current.cells[columnIndex]) {
            current.cells[columnIndex].remove();
        }
    }

    placeCaretAtStart(row.cells[Math.min(columnIndex, row.cells.length - 1)]);

    return true;
}

export function deleteTable(surface, context) {
    const { table } = context;
    const doc = table.ownerDocument;
    let next = table.nextElementSibling;

    if (!next || next.nodeName !== 'P') {
        next = doc.createElement('p');
        next.appendChild(doc.createElement('br'));
        table.parentNode.insertBefore(next, table.nextSibling);
    }

    table.remove();
    placeCaretAtStart(next);

    return true;
}

export function toggleHeaderRow(context) {
    const { table } = context;
    const doc = table.ownerDocument;
    const thead = table.tHead;

    if (thead) {
        const row = thead.rows[0];
        const tbody = body(table);

        for (const current of Array.from(row.cells)) {
            const replacement = rename(current, 'td');
            replacement.removeAttribute('scope');
        }

        tbody.insertBefore(row, tbody.firstChild);
        thead.remove();
    } else {
        const tbody = body(table);
        const row = tbody.rows[0];

        if (!row) {
            return false;
        }

        const head = doc.createElement('thead');

        for (const current of Array.from(row.cells)) {
            const replacement = rename(current, 'th');
            replacement.setAttribute('scope', 'col');
        }

        head.appendChild(row);
        table.insertBefore(head, tbody);

        if (!tbody.rows.length) {
            tbody.appendChild(doc.createElement('tr'));

            for (let index = 0; index < head.rows[0].cells.length; index += 1) {
                tbody.rows[0].appendChild(cell(doc, 'td'));
            }
        }
    }

    const target = table.rows[context.rowIndex] || table.rows[0];
    placeCaretAtEnd(target.cells[Math.min(context.columnIndex, target.cells.length - 1)]);

    return true;
}

export function tablePresets(table) {
    return (table.getAttribute('class') || '')
        .split(/\s+/)
        .filter((name) => name.startsWith('ipx-rte-table--'))
        .map((name) => name.slice('ipx-rte-table--'.length));
}

export function setTablePresets(table, presets) {
    table.setAttribute('class', presetClasses(presets));
}

/** Tab / Shift+Tab navigation. Tab in the last cell appends a row. */
export function moveToCell(context, forward) {
    const { table, row, cell: current } = context;
    const cells = Array.from(table.querySelectorAll('th, td'));
    const index = cells.indexOf(current);
    const target = cells[index + (forward ? 1 : -1)];

    if (target) {
        placeCaretAtEnd(target);
        return true;
    }

    if (forward) {
        addRow({ ...context, row: table.rows[table.rows.length - 1] || row, columnIndex: 0 }, true);
        return true;
    }

    return false;
}
