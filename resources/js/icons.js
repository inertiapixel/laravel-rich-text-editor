/**
 * Toolbar icons: 20x20 stroke paths drawn with createElementNS.
 */

const SVG = 'http://www.w3.org/2000/svg';

const PATHS = {
    undo: 'M7 4 3 8l4 4M3 8h9.5a4.5 4.5 0 0 1 0 9H9',
    redo: 'M13 4l4 4-4 4M17 8H7.5a4.5 4.5 0 0 0 0 9H11',
    bold: 'M6 4h5a3 3 0 0 1 0 6H6zM6 10h6a3 3 0 0 1 0 6H6z',
    italic: 'M9 4h6M5 16h6M12 4 8 16',
    underline: 'M6 3v6a4 4 0 0 0 8 0V3M4 17h12',
    strikethrough: 'M4 10h12M13.5 6.5C13 5 11.7 4 10 4 8 4 6.5 5.2 6.5 6.8c0 1.2.8 2 2.2 2.6M7 13.5c.5 1.6 1.8 2.5 3.2 2.5 2 0 3.5-1.1 3.5-2.8 0-.6-.2-1.1-.5-1.5',
    inline_code: 'M7 6l-4 4 4 4M13 6l4 4-4 4',
    bullet_list: 'M8 5h9M8 10h9M8 15h9M3.5 5h.01M3.5 10h.01M3.5 15h.01',
    ordered_list: 'M8 5h9M8 10h9M8 15h9M3 3.5h1.2v3.5M3 7h2.4M3 12.3c0-.7.5-1.1 1.2-1.1s1.2.4 1.2 1c0 .9-2.4 1.6-2.4 2.8h2.4',
    outdent: 'M3 4h14M9 8h8M9 12h8M3 16h14M6 8l-3 2 3 2',
    indent: 'M3 4h14M9 8h8M9 12h8M3 16h14M3 8l3 2-3 2',
    align_left: 'M3 4h14M3 8h9M3 12h14M3 16h9',
    align_center: 'M3 4h14M5.5 8h9M3 12h14M5.5 16h9',
    align_right: 'M3 4h14M8 8h9M3 12h14M8 16h9',
    align_justify: 'M3 4h14M3 8h14M3 12h14M3 16h14',
    link: 'M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1',
    unlink: 'M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1M3 3l14 14',
    blockquote: 'M8 6H5v4h3v1c0 1.5-1 2.5-2.5 3M16 6h-3v4h3v1c0 1.5-1 2.5-2.5 3',
    code_block: 'M3 4h14v12H3zM8 8l-2 2 2 2M12 8l2 2-2 2',
    horizontal_rule: 'M3 10h14M6 5.5h8M6 14.5h8',
    image: 'M3 4h14v12H3zM3 13l4-4 3 3 2-2 5 5M13 7.5h.01',
    file: 'M14.5 9.5 9 15a3.2 3.2 0 0 1-4.5-4.5l6-6a2.1 2.1 0 0 1 3 3l-6 6a1 1 0 0 1-1.5-1.5l5.5-5.5',
    table: 'M3 4h14v12H3zM3 8h14M3 12h14M8 4v12M12 4v12',
    clear_formatting: 'M5 4h10M10 4 7 16M12 11l5 5M17 11l-5 5',
};

export function createIcon(doc, name) {
    const path = PATHS[name];

    if (!path) {
        return null;
    }

    const svg = doc.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'ipx-rte__icon');

    const element = doc.createElementNS(SVG, 'path');
    element.setAttribute('d', path);
    svg.appendChild(element);

    return svg;
}
