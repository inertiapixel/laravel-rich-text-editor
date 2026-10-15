/**
 * One editor instance. All state lives on the instance; nothing is shared
 * between editors except the module-level code itself.
 */

import {
    MARK_TAGS,
    applyLink,
    caretRange,
    changeIndent,
    clearFormatting,
    currentAlignment,
    currentBlockType,
    currentListType,
    ensureStructure,
    handleBackspace,
    handleDelete,
    insertBlock,
    insertFragment,
    insertHorizontalRule,
    insertLineBreak,
    insertParagraph,
    insertTextWithMarks,
    isMarkActive,
    linkAtSelection,
    relaxSpaceBeforeCaret,
    removeLink,
    setAlignment,
    setBlockType,
    toggleBlockquote,
    toggleCodeBlock,
    toggleList,
    toggleMark,
} from './commands.js';
import { MODE_FORMAT, convert, fromTree, inspectHtml, textToFragment, toTree } from './convert.js';
import { Counter } from './counter.js';
import { ConfirmDialog, FileDialog, ImageDialog, LinkDialog, TableDesignDialog, TableDialog } from './dialogs.js';
import { classList, closestTag, codePointLength, el, isElement, rename, unwrap, uniqueId } from './dom.js';
import { History, nodePath, resolvePath } from './history.js';
import {
    MARKDOWN_COMMANDS,
    codeBlock,
    escapeLinkText,
    inlineCode,
    insertBlock as insertMarkdownBlock,
    insertInline,
    markdownTitle,
    markdownUrl,
    selectedText,
    tableSkeleton,
    toggleLinePrefix,
    wrapInline,
} from './markdown-commands.js';
import { getRange, insertMarkers, placeCaretAtEnd, restoreMarkers, setRange, textBlockOf } from './selection.js';
import { countVisibleCharacters, countWords, createPolicy, extractText, importHtml, serializeHtml } from './serializer.js';
import { createTranslator } from './strings.js';
import {
    addColumn,
    addRow,
    createTable,
    deleteColumn,
    deleteRow,
    deleteTable,
    moveToCell,
    setTablePresets,
    tableContext,
    tablePresets,
    toggleHeaderRow,
} from './tables.js';
import { IS_MAC, Toolbar } from './toolbar.js';

const NATIVE_MODE = { html: 'rich', markdown: 'markdown', text: 'text' };

const TABLE_COMMANDS = ['row_above', 'row_below', 'delete_row', 'column_left', 'column_right', 'delete_column', 'header_row', 'table_design', 'delete_table'];

const DEFAULT_CONFIG = {
    modes: ['rich', 'code'],
    defaultMode: 'rich',
    markdownPreview: true,
    placeholder: null,
    minHeight: '240px',
    maxHeight: null,
    theme: 'light',
    contentClass: '',
    toolbar: ['undo', 'redo', '|', 'heading', '|', 'bold', 'italic', 'underline', 'strikethrough', 'inline_code', '|', 'bullet_list', 'ordered_list', 'outdent', 'indent', '|', 'link', 'unlink', 'blockquote', 'code_block', 'horizontal_rule', '|', 'image', 'table', '|', 'clear_formatting'],
    headings: [1, 2, 3, 4],
    maxIndent: 4,
    shortcuts: {
        undo: 'Mod+Z', redo: 'Mod+Shift+Z', bold: 'Mod+B', italic: 'Mod+I', underline: 'Mod+U',
        strikethrough: 'Mod+Shift+X', inline_code: 'Mod+E', link: 'Mod+K', paragraph: 'Mod+Alt+0',
        heading_1: 'Mod+Alt+1', heading_2: 'Mod+Alt+2', heading_3: 'Mod+Alt+3', heading_4: 'Mod+Alt+4',
        heading_5: 'Mod+Alt+5', heading_6: 'Mod+Alt+6', bullet_list: 'Mod+Shift+8', ordered_list: 'Mod+Shift+7',
        blockquote: 'Mod+Shift+9', code_block: 'Mod+Alt+C', clear_formatting: 'Mod+\\', focus_toolbar: 'Alt+F10',
    },
    links: { enabled: true, allowNewTab: true, protocols: ['http', 'https', 'mailto', 'tel'] },
    images: {
        enabled: true, upload: false, uploadReady: false, allowUrl: true, formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
        mimes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'], maxSize: 5 * 1024 * 1024, alt: true, requireAlt: true,
        title: true, caption: true, classes: {}, customClasses: false, dimensions: true, height: false, units: ['%', 'px'],
        percentSteps: [25, 33, 50, 66, 75, 100], maxPixels: 4000, alignments: ['left', 'center', 'right'], display: true, pasteUpload: false,
    },
    files: { enabled: false, uploadReady: false, formats: [], mimes: [], maxSize: 10 * 1024 * 1024 },
    upload: { url: null, field: 'file' },
    tables: { enabled: true, presets: {}, defaultPresets: [], maxRows: 50, maxColumns: 12, headerRow: true },
    limits: { min: null, max: null, enforceMax: false, validateOnSubmit: true },
    counter: { show: null, words: false },
    paste: { mode: 'semantic', allowDataImages: false },
    announceLimits: true,
    locale: 'en',
    strings: {},
    initialFormat: null,
    formatField: null,
    required: false,
    readonly: false,
    disabled: false,
    ariaLabel: null,
};

function mergeConfig(defaults, config) {
    const result = { ...defaults };

    for (const [key, value] of Object.entries(config || {})) {
        const base = defaults[key];

        result[key] = base && typeof base === 'object' && !Array.isArray(base) && value && typeof value === 'object' && !Array.isArray(value)
            ? mergeConfig(base, value)
            : value;
    }

    return result;
}

function parseShortcut(spec) {
    const parts = spec.split('+');
    const key = parts.pop().toLowerCase();

    return {
        key,
        mod: parts.includes('Mod'),
        shift: parts.includes('Shift'),
        alt: parts.includes('Alt'),
    };
}

function codeKey(code) {
    if (/^Key[A-Z]$/.test(code)) {
        return code.slice(3).toLowerCase();
    }

    if (/^Digit\d$/.test(code)) {
        return code.slice(5);
    }

    return { Backslash: '\\', Slash: '/', Period: '.', Comma: ',', Minus: '-', Equal: '=' }[code] || code.toLowerCase();
}

function normalizeNewlines(value) {
    return String(value).replace(/\r\n?/g, '\n');
}

export class Editor {
    constructor(root, config, hooks = {}) {
        this.root = root;
        this.doc = root.ownerDocument;
        this.config = mergeConfig(DEFAULT_CONFIG, config);
        this.hooks = hooks;
        this.t = createTranslator(this.config.strings, this.config.locale);
        this.policy = createPolicy(this.config);
        this.field = (this.config.field && this.doc.getElementById(this.config.field)) || root.querySelector('.ipx-rte__field');
        this.formatInput = root.querySelector('[data-ipx-rte-format]');
        this.abort = new AbortController();
        this.state = { pendingMarks: new Set(), pendingAt: null };
        this.dialogCache = new Map();
        this.dialogElements = new Set();
        this.cache = new Map();
        this.mode = null;
        this.format = this.config.initialFormat || 'html';
        this.preview = false;
        this.composing = false;
        this.locked = !!(this.config.readonly || this.config.disabled);
        this.lastRange = null;
        this.lastSync = null;
        this.selectedImage = null;
        this.themeClass = this.config.theme === 'dark' ? 'ipx-rte--theme-dark' : this.config.theme === 'auto' ? 'ipx-rte--theme-auto' : '';
        this.shortcuts = Object.entries(this.config.shortcuts || {}).map(([name, spec]) => ({ name, ...parseShortcut(spec) }));
    }

    // -----------------------------------------------------------------------
    // Mounting
    // -----------------------------------------------------------------------

    mount() {
        if (!this.field) {
            throw new Error('InertiaPixel Rich Text Editor: the form field is missing.');
        }

        const doc = this.doc;
        const config = this.config;

        this.surfaceId = uniqueId('ipx-rte-surface');
        this.sourceId = uniqueId('ipx-rte-source');
        this.initialValue = this.field.value;
        this.initialFormat = this.format;

        if (this.themeClass) {
            this.root.classList.add(this.themeClass);
        }

        if (config.minHeight) {
            this.root.style.setProperty('--ipx-rte-min-height', config.minHeight);
        }

        if (config.maxHeight) {
            this.root.style.setProperty('--ipx-rte-max-height', config.maxHeight);
        }

        this.toolbar = new Toolbar(this);
        this.tableBar = this.buildTableBar();

        this.surface = el(doc, 'div', {
            id: this.surfaceId,
            className: `ipx-rte__surface ipx-rte-content ${config.contentClass || ''}`.trim(),
            contenteditable: this.locked ? 'false' : 'true',
            role: 'textbox',
            'aria-multiline': 'true',
            spellcheck: 'true',
            translate: 'no',
            'data-placeholder': config.placeholder || null,
        });

        this.source = el(doc, 'textarea', {
            id: this.sourceId,
            className: 'ipx-rte__source',
            hidden: true,
            rows: '10',
            autocomplete: 'off',
            placeholder: config.placeholder || null,
        });

        this.source.readOnly = this.locked;
        this.source.disabled = !!config.disabled;

        this.previewPane = el(doc, 'div', { className: `ipx-rte__preview ipx-rte-content ${config.contentClass || ''}`.trim(), hidden: true, tabindex: '0' });
        this.body = el(doc, 'div', { className: 'ipx-rte__body' }, [this.surface, this.source, this.previewPane]);
        this.notice = el(doc, 'p', { className: 'ipx-rte__notice', role: 'status', hidden: true });
        this.counter = new Counter(this);
        this.footer = el(doc, 'div', { className: 'ipx-rte__footer', hidden: !this.counter.visible }, [this.counter.element]);
        this.clientError = el(doc, 'p', { className: 'ipx-rte__client-error', id: uniqueId('ipx-rte-error'), role: 'alert', hidden: true });

        const fragment = doc.createDocumentFragment();
        fragment.append(this.toolbar.element, this.tableBar, this.body, this.notice, this.footer, this.clientError, this.counter.live);
        this.root.insertBefore(fragment, this.field);

        this.setupAccessibility();

        if (this.field.hasAttribute('required')) {
            // Native validation cannot focus a hidden field; the editor
            // validates on submit instead.
            this.field.removeAttribute('required');
            this.removedRequired = true;
        }

        this.root.classList.add('ipx-rte--ready');

        this.history = new History({
            capture: () => this.capture(),
            restore: (snapshot) => this.restore(snapshot),
            onChange: () => this.updateToolbar(),
        });

        const format = this.format;
        this.load(format, this.field.value, this.initialMode(format));
        this.history.reset();
        this.bindEvents();
        this.sync();
        this.updateToolbar();
        this.emit('ready');

        return this;
    }

    setupAccessibility() {
        const label = this.field.id ? this.doc.querySelector(`label[for="${CSS.escape(this.field.id)}"]`) : null;
        const ariaLabel = this.config.ariaLabel || this.field.getAttribute('aria-label');

        for (const target of [this.surface, this.source]) {
            if (label) {
                if (!label.id) {
                    label.id = `${this.field.id}-label`;
                }

                target.setAttribute('aria-labelledby', label.id);
            } else {
                target.setAttribute('aria-label', ariaLabel || this.t('editor_label'));
            }

            if (this.config.required) {
                target.setAttribute('aria-required', 'true');
            }

            if (this.config.readonly) {
                target.setAttribute('aria-readonly', 'true');
            }

            if (this.config.disabled) {
                target.setAttribute('aria-disabled', 'true');
            }
        }

        if (label) {
            label.addEventListener('click', (event) => {
                event.preventDefault();
                this.focus();
            }, { signal: this.abort.signal });
        }

        this.serverError = this.root.querySelector('[data-ipx-rte-server-error]');

        if (this.serverError) {
            this.surface.setAttribute('aria-invalid', 'true');
            this.source.setAttribute('aria-invalid', 'true');
        }

        this.updateDescribedBy();
    }

    updateDescribedBy() {
        const ids = [];

        if (this.counter.visible) {
            ids.push(this.counter.element.id);
        }

        if (this.serverError && this.serverError.isConnected && this.serverError.id) {
            ids.push(this.serverError.id);
        }

        if (!this.clientError.hidden) {
            ids.push(this.clientError.id);
        }

        for (const target of [this.surface, this.source]) {
            if (ids.length) {
                target.setAttribute('aria-describedby', ids.join(' '));
            } else {
                target.removeAttribute('aria-describedby');
            }
        }
    }

    buildTableBar() {
        const bar = el(this.doc, 'div', { className: 'ipx-rte__tablebar', role: 'toolbar', 'aria-label': this.t('table_toolbar'), hidden: true });

        if (!this.config.tables.enabled) {
            return bar;
        }

        this.tableButtons = new Map();

        for (const name of TABLE_COMMANDS) {
            if (name === 'table_design' && !Object.keys(this.config.tables.presets || {}).length) {
                continue;
            }

            const button = el(this.doc, 'button', {
                type: 'button',
                className: `ipx-rte__table-button ipx-rte__table-button--${name.replace(/_/g, '-')}`,
                'data-command': name,
                text: this.t(name),
            });

            if (name === 'header_row') {
                button.setAttribute('aria-pressed', 'false');
            }

            button.addEventListener('mousedown', (event) => event.preventDefault());
            button.addEventListener('click', () => this.command(name));
            this.tableButtons.set(name, button);
            bar.appendChild(button);
        }

        return bar;
    }

    initialMode(format) {
        const modes = this.config.modes;
        const preferred = modes.includes(this.config.defaultMode) ? this.config.defaultMode : modes[0];

        if (preferred === 'code' || MODE_FORMAT[preferred] === format) {
            return preferred;
        }

        // Keep the stored format instead of converting it on load.
        if (modes.includes(NATIVE_MODE[format])) {
            return NATIVE_MODE[format];
        }

        if (modes.includes('code')) {
            return 'code';
        }

        return preferred;
    }

    load(format, value, mode) {
        let content = normalizeNewlines(value || '');
        let target = mode === 'code' ? format : MODE_FORMAT[mode];

        if (target !== format) {
            const result = convert(format, target, content, this.policy, { document: this.doc });

            if (result.lossy && typeof console !== 'undefined') {
                console.warn(`InertiaPixel Rich Text Editor: converting the initial ${format} value to ${target} lost formatting.`);
            }

            content = result.value;
        }

        if (mode === 'code' && format === 'html') {
            content = fromTree('html', toTree('html', content, this.policy, { document: this.doc }).root, { pretty: true });
        }

        this.applyMode(mode, target, content, { focus: false });
    }

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    bindEvents() {
        const signal = this.abort.signal;
        const on = (target, type, handler, options = {}) => target.addEventListener(type, handler, { ...options, signal });

        on(this.surface, 'beforeinput', (event) => this.onBeforeInput(event));
        on(this.surface, 'input', (event) => this.onInput(event));
        on(this.surface, 'keydown', (event) => this.onKeydown(event));
        on(this.surface, 'paste', (event) => this.onPaste(event));
        on(this.surface, 'drop', (event) => this.onDrop(event));
        on(this.surface, 'dragstart', () => {
            this.internalDrag = true;
        });
        on(this.surface, 'dragend', () => {
            this.internalDrag = false;
        });
        on(this.surface, 'compositionstart', () => {
            this.composing = true;
        });
        on(this.surface, 'compositionend', () => {
            this.composing = false;
            this.normalizeSurface();
            this.afterChange('typing');
        });
        on(this.surface, 'click', (event) => this.onSurfaceClick(event));
        on(this.surface, 'dblclick', (event) => {
            if (event.target.nodeName === 'IMG' && !this.locked) {
                this.selectImage(event.target);
                this.openImageDialog();
            }
        });
        on(this.surface, 'cut', () => {
            setTimeout(() => {
                this.normalizeSurface();
                this.afterChange('change');
            }, 0);
        });

        on(this.source, 'beforeinput', (event) => this.onSourceBeforeInput(event));
        on(this.source, 'input', () => this.afterChange('typing'));
        on(this.source, 'keydown', (event) => this.onKeydown(event));
        on(this.source, 'paste', (event) => this.onSourcePaste(event));

        for (const target of [this.surface, this.source]) {
            on(target, 'focus', () => this.root.classList.add('ipx-rte--focused'));
            on(target, 'blur', () => {
                this.root.classList.remove('ipx-rte--focused');
                this.sync();
            });
        }

        const form = this.field.form;

        if (form) {
            on(form, 'submit', (event) => this.onSubmit(event), { capture: true });
            on(form, 'formdata', (event) => {
                this.sync();

                if (!this.field.disabled && this.field.name && !this.field.name.endsWith('[]')) {
                    event.formData.set(this.field.name, this.field.value);

                    if (this.formatInput && !this.formatInput.disabled) {
                        event.formData.set(this.formatInput.name, this.format);
                    }
                }
            });
            on(form, 'reset', () => {
                setTimeout(() => this.setValue(this.initialValue, this.initialFormat, { resetHistory: true }), 0);
            });
        }
    }

    onSelectionChange() {
        if (this.mode !== 'rich' || this.destroyed) {
            return;
        }

        const range = getRange(this.surface);

        if (range) {
            this.lastRange = range.cloneRange();

            const pending = this.state.pendingAt;

            if (pending && (range.startContainer !== pending.node || range.startOffset !== pending.offset)) {
                this.state.pendingMarks.clear();
                this.state.pendingAt = null;
            }

            const image = range.startContainer === range.endContainer && range.endOffset - range.startOffset === 1
                ? range.startContainer.childNodes[range.startOffset]
                : null;

            if (image && image.nodeName === 'IMG') {
                this.markImage(image);
            } else {
                this.markImage(null);
            }
        }

        this.updateToolbar();
    }

    onSurfaceClick(event) {
        if (event.target.nodeName === 'IMG' && this.surface.contains(event.target)) {
            this.selectImage(event.target);
        }
    }

    selectImage(image) {
        const range = this.doc.createRange();
        range.selectNode(image);
        setRange(range);
        this.markImage(image);
    }

    markImage(image) {
        if (this.selectedImage && this.selectedImage !== image) {
            this.selectedImage.removeAttribute('data-ipx-rte-selected');
        }

        this.selectedImage = image;

        if (image) {
            image.setAttribute('data-ipx-rte-selected', '');
        }
    }

    matchShortcut(event) {
        const mod = IS_MAC ? event.metaKey : event.ctrlKey;
        const key = (event.key || '').toLowerCase();
        const fromCode = codeKey(event.code || '');

        for (const shortcut of this.shortcuts) {
            if (shortcut.mod === mod && shortcut.shift === event.shiftKey && shortcut.alt === event.altKey
                && (shortcut.key === key || shortcut.key === fromCode)
                && (IS_MAC ? !event.ctrlKey : !event.metaKey)) {
                return shortcut.name;
            }
        }

        if (!IS_MAC && event.ctrlKey && !event.shiftKey && !event.altKey && (key === 'y' || fromCode === 'y')) {
            return 'redo';
        }

        return null;
    }

    onKeydown(event) {
        if (event.isComposing || event.keyCode === 229) {
            return;
        }

        const mod = IS_MAC ? event.metaKey : event.ctrlKey;

        if (mod && event.shiftKey && (event.key || '').toLowerCase() === 'v') {
            this.plainPasteNext = true;
            return;
        }

        const name = this.matchShortcut(event);

        if (name) {
            event.preventDefault();

            if (name === 'focus_toolbar') {
                this.toolbar.focusFirst();
            } else if (/^heading_\d$/.test(name)) {
                this.command('block', `h${name.slice(-1)}`);
            } else if (name === 'paragraph') {
                this.command('block', 'p');
            } else {
                this.command(name);
            }

            return;
        }

        if (this.mode !== 'rich' || this.locked) {
            return;
        }

        if (event.key === 'Tab' && !event.altKey && !mod) {
            const range = getRange(this.surface);
            const context = tableContext(this.surface, range);

            if (context) {
                event.preventDefault();
                moveToCell(context, !event.shiftKey);
                this.afterChange('change');

                return;
            }

            if (range && closestTag(range.startContainer, 'LI', this.surface)) {
                event.preventDefault();
                this.command(event.shiftKey ? 'outdent' : 'indent');
            }

            return;
        }

        if (event.key === 'Enter' && this.selectedImage && !event.shiftKey) {
            event.preventDefault();
            this.openImageDialog();

            return;
        }

        // Handle Enter here rather than only in beforeinput: browsers
        // disagree on whether Shift+Enter is insertParagraph or
        // insertLineBreak. Virtual keyboards still go through beforeinput.
        if (event.key === 'Enter' && !mod && !event.altKey) {
            event.preventDefault();

            if (event.shiftKey) {
                insertLineBreak(this.surface);
            } else {
                insertParagraph(this.surface);
            }

            this.afterChange('change');
        }
    }

    onBeforeInput(event) {
        if (this.locked) {
            event.preventDefault();
            return;
        }

        const type = event.inputType;

        if (type === 'historyUndo' || type === 'historyRedo') {
            event.preventDefault();
            this.command(type === 'historyUndo' ? 'undo' : 'redo');

            return;
        }

        const format = { formatBold: 'bold', formatItalic: 'italic', formatUnderline: 'underline', formatStrikeThrough: 'strikethrough' }[type];

        if (format) {
            event.preventDefault();
            this.command(format);

            return;
        }

        if (event.isComposing || this.composing) {
            return;
        }

        let range = getRange(this.surface);

        if (!range) {
            return;
        }

        if (type === 'insertParagraph') {
            event.preventDefault();
            insertParagraph(this.surface);
            this.afterChange('change');

            return;
        }

        if (type === 'insertLineBreak') {
            event.preventDefault();
            insertLineBreak(this.surface);
            this.afterChange('change');

            return;
        }

        if (type === 'deleteContentBackward' && this.selectedImage) {
            event.preventDefault();
            this.removeSelectedImage();

            return;
        }

        if (type === 'deleteContentBackward' && handleBackspace(this.surface, range)) {
            event.preventDefault();
            this.afterChange('change');

            return;
        }

        if (type === 'deleteContentForward' && handleDelete(this.surface, range)) {
            event.preventDefault();
            this.afterChange('change');

            return;
        }

        if (type === 'insertText' || type === 'insertReplacementText') {
            const data = event.data ?? (event.dataTransfer ? event.dataTransfer.getData('text/plain') : '');

            if (data && this.wouldExceed(range, data)) {
                event.preventDefault();
                this.counter.announce(this.t('max_reached', { max: this.config.limits.max }));

                return;
            }

            const outside = !textBlockOf(range.startContainer, this.surface);
            const pending = this.state.pendingMarks.size > 0 && range.collapsed && type === 'insertText';

            if (data && (outside || pending)) {
                event.preventDefault();

                if (outside) {
                    range = caretRange(this.surface);
                }

                insertTextWithMarks(this.surface, range, data, pending ? Array.from(this.state.pendingMarks) : []);
                this.state.pendingMarks.clear();
                this.state.pendingAt = null;
                this.afterChange('typing');
            }
        }
    }

    onInput(event) {
        if (this.composing || event.isComposing) {
            return;
        }

        if (event.inputType === 'insertText' && event.data && !/\s/.test(event.data)) {
            relaxSpaceBeforeCaret(this.surface);
        }

        this.normalizeSurface();
        this.afterChange(event.inputType === 'insertText' ? 'typing' : 'change');
    }

    onSourceBeforeInput(event) {
        if (this.locked) {
            event.preventDefault();
            return;
        }

        if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
            event.preventDefault();
            this.command(event.inputType === 'historyUndo' ? 'undo' : 'redo');

            return;
        }

        if (event.isComposing) {
            return;
        }

        const data = event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph' ? '\n' : event.data;

        if ((event.inputType.startsWith('insert')) && data && this.wouldExceedSource(data)) {
            event.preventDefault();
            this.counter.announce(this.t('max_reached', { max: this.config.limits.max }));
        }
    }

    onSourcePaste(event) {
        if (this.locked) {
            event.preventDefault();
            return;
        }

        const text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';

        if (text && this.wouldExceedSource(normalizeNewlines(text))) {
            event.preventDefault();
            this.counter.announce(this.t('paste_too_long', { max: this.config.limits.max }));
        }
    }

    onPaste(event) {
        event.preventDefault();

        if (this.locked || !event.clipboardData) {
            return;
        }

        const data = event.clipboardData;
        const html = data.getData('text/html');
        const text = data.getData('text/plain');
        const files = Array.from(data.files || []);
        const plain = this.plainPasteNext || this.config.paste.mode === 'text';

        this.plainPasteNext = false;

        if (files.length && !html && !text) {
            this.handleFiles(files);
            return;
        }

        let fragment = null;

        if (!plain && html) {
            fragment = importHtml(html, this.policy, { document: this.doc, mapStyles: true }).fragment;
        }

        // Never lose the user's content: fall back to plain text.
        if ((!fragment || !fragment.textContent.trim()) && text && !(fragment && fragment.querySelector && fragment.querySelector('img, table, hr'))) {
            fragment = textToFragment(text, this.doc);
        }

        if (!fragment || !fragment.childNodes.length) {
            return;
        }

        this.insertContent(fragment);
    }

    onDrop(event) {
        if (this.locked) {
            event.preventDefault();
            return;
        }

        // Moving content inside the editor is native; the result is
        // normalized on input.
        if (this.internalDrag) {
            return;
        }

        event.preventDefault();

        const transfer = event.dataTransfer;

        if (!transfer) {
            return;
        }

        this.placeCaretAtPoint(event.clientX, event.clientY);

        const files = Array.from(transfer.files || []);

        if (files.length) {
            this.handleFiles(files);
            return;
        }

        const html = transfer.getData('text/html');
        const text = transfer.getData('text/plain');
        let fragment = html ? importHtml(html, this.policy, { document: this.doc, mapStyles: true }).fragment : null;

        if ((!fragment || !fragment.textContent.trim()) && text) {
            fragment = textToFragment(text, this.doc);
        }

        if (fragment && fragment.childNodes.length) {
            this.insertContent(fragment);
        }
    }

    placeCaretAtPoint(x, y) {
        let range = null;

        if (this.doc.caretPositionFromPoint) {
            const position = this.doc.caretPositionFromPoint(x, y);

            if (position) {
                range = this.doc.createRange();
                range.setStart(position.offsetNode, position.offset);
            }
        } else if (this.doc.caretRangeFromPoint) {
            range = this.doc.caretRangeFromPoint(x, y);
        }

        if (range && this.surface.contains(range.startContainer)) {
            range.collapse(true);
            setRange(range);
        }
    }

    insertContent(fragment) {
        this.focusSurface();

        let range = getRange(this.surface) || caretRange(this.surface);

        if (this.config.limits.enforceMax && this.config.limits.max !== null) {
            const holder = this.doc.createElement('div');
            holder.appendChild(fragment.cloneNode(true));

            if (this.wouldExceed(range, extractText(holder).replace(/\n/g, ''))) {
                this.counter.announce(this.t('paste_too_long', { max: this.config.limits.max }));
                return;
            }
        }

        this.history.seal();
        insertFragment(this.surface, range, fragment);
        this.normalizeSurface();
        this.afterChange('change');
    }

    handleFiles(files) {
        const image = files.find((file) => file.type.startsWith('image/'));

        if (image && this.config.images.enabled && this.config.images.pasteUpload) {
            this.openImageDialog({ file: image });
            return;
        }

        const other = files.find((file) => !file.type.startsWith('image/')) || (!this.config.images.enabled ? image : null);

        if (other && this.config.files.enabled) {
            this.openFileDialog({ file: other });
        }
    }

    onSubmit(event) {
        const form = this.field.form;
        const skip = form.noValidate || (event.submitter && event.submitter.formNoValidate);

        this.sync();

        if (skip || this.config.disabled) {
            return;
        }

        if (!this.validate()) {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.focus();
        }
    }

    // -----------------------------------------------------------------------
    // Limits and validation
    // -----------------------------------------------------------------------

    liveCount() {
        if (this.mode === 'rich') {
            return countVisibleCharacters(this.surface);
        }

        if (this.mode === 'code' && this.format === 'html') {
            return this.measure(this.source.value).count;
        }

        return codePointLength(normalizeNewlines(this.source.value));
    }

    wouldExceed(range, text) {
        const { enforceMax, max } = this.config.limits;

        if (!enforceMax || max === null || max === undefined) {
            return false;
        }

        const selected = range && !range.collapsed ? codePointLength(range.toString().replace(/[\t\n\r\f ]+/g, ' ')) : 0;
        const added = codePointLength(text.replace(/[\t\n\r\f ]+/g, ' '));

        return this.liveCount() - selected + added > max;
    }

    wouldExceedSource(text) {
        const { enforceMax, max } = this.config.limits;

        if (!enforceMax || max === null || max === undefined || (this.mode === 'code' && this.format === 'html')) {
            return false;
        }

        const selected = this.source.selectionEnd - this.source.selectionStart;
        const current = this.source.value;
        const selectedLength = codePointLength(current.slice(this.source.selectionStart, this.source.selectionStart + selected));

        return codePointLength(normalizeNewlines(current)) - selectedLength + codePointLength(text) > max;
    }

    validate() {
        return this.check(this.sync());
    }

    /** Validate a sync result and show or clear the client-side error. */
    check({ count, empty }) {
        const { min, max, validateOnSubmit } = this.config.limits;
        let message = null;

        if (this.config.required && empty) {
            message = this.t('required');
        } else if (validateOnSubmit && max !== null && max !== undefined && count > max) {
            message = this.t('max_exceeded', { max, over: count - max });
        } else if (validateOnSubmit && min !== null && min !== undefined && count < min && !(empty && !this.config.required)) {
            message = this.t('min_not_met', { min, remaining: min - count });
        }

        this.showClientError(message);

        return message === null;
    }

    showClientError(message) {
        this.clientError.textContent = message || '';
        this.clientError.hidden = !message;
        this.root.classList.toggle('ipx-rte--invalid', !!message || !!(this.serverError && this.serverError.isConnected));

        for (const target of [this.surface, this.source]) {
            if (message || (this.serverError && this.serverError.isConnected)) {
                target.setAttribute('aria-invalid', 'true');
            } else {
                target.removeAttribute('aria-invalid');
            }
        }

        this.updateDescribedBy();
    }

    // -----------------------------------------------------------------------
    // Content, sync and history
    // -----------------------------------------------------------------------

    /** Measure an HTML document: serialized value, visible count, words. */
    measure(html) {
        const tree = toTree('html', html, this.policy, { document: this.doc }).root;
        const text = extractText(tree);

        return {
            value: serializeHtml(tree, { pretty: false }),
            count: codePointLength(text.replace(/\n/g, '')),
            words: countWords(text),
            empty: !text && !tree.querySelector('img, table, hr'),
        };
    }

    snapshotValue() {
        if (this.mode === 'rich') {
            const fragment = importHtml(this.surface, this.policy, { document: this.doc }).fragment;
            const holder = this.doc.createElement('div');
            holder.appendChild(fragment);

            const text = extractText(holder);

            return {
                value: serializeHtml(holder, { pretty: false }),
                count: codePointLength(text.replace(/\n/g, '')),
                words: countWords(text),
                empty: !text && !holder.querySelector('img, table, hr'),
            };
        }

        if (this.mode === 'code' && this.format === 'html') {
            return this.measure(this.source.value);
        }

        const value = normalizeNewlines(this.source.value);

        return { value, count: codePointLength(value), words: countWords(value), empty: value.trim() === '' };
    }

    /** The stored value in the current format (what the form submits). */
    getValue() {
        return this.snapshotValue().value;
    }

    sync() {
        clearTimeout(this.syncTimer);
        this.syncTimer = null;

        const result = this.snapshotValue();
        const changed = !this.lastSync || this.lastSync.value !== result.value || this.lastSync.format !== this.format;

        this.field.value = result.value;

        if (this.formatInput) {
            this.formatInput.value = this.format;
        }

        this.counter.update(result.count, result.words);
        this.lastSync = { ...result, format: this.format };
        this.updatePlaceholder(result.empty);

        // The first sync only normalizes the initial value; later changes
        // notify listeners (Alpine x-model, Livewire, custom code).
        if (changed && this.lastSyncReady) {
            this.field.dispatchEvent(new Event('input', { bubbles: true }));
            this.emit('change', { value: result.value, format: this.format, mode: this.mode });
        }

        this.lastSyncReady = true;

        // Once an error is shown, re-check as the user fixes the content.
        if (!this.clientError.hidden) {
            this.check(result);
        }

        return result;
    }

    scheduleSync() {
        clearTimeout(this.syncTimer);
        this.syncTimer = setTimeout(() => this.sync(), 150);
    }

    updatePlaceholder(empty) {
        const isEmpty = empty === undefined
            ? !this.surface.textContent.trim() && !this.surface.querySelector('img, table, hr, li, blockquote, pre')
            : empty && !this.surface.querySelector('img, table, hr, li, blockquote, pre');

        this.surface.classList.toggle('ipx-rte__surface--empty', this.mode === 'rich' && isEmpty && !!this.config.placeholder);
    }

    afterChange(kind = 'change') {
        if (this.mode === 'rich') {
            ensureStructure(this.surface);
            this.updatePlaceholder();
        }

        if (this.mode === 'code' && this.format === 'html') {
            this.scheduleNotice();
        }

        if (this.mode === 'markdown' && this.preview) {
            this.renderPreview();
        }

        this.history.record(kind);
        this.scheduleSync();
        this.updateToolbar();
    }

    /** Clean up markup that browsers add while editing (spans, styles, divs). */
    normalizeSurface() {
        const surface = this.surface;
        const junk = surface.querySelector('[style], font, span:not([data-ipx-rte-marker]), div, b, i, strike, del, ins, meta, center, h1:empty, [class*="Apple-"]');
        const stray = Array.from(surface.childNodes).some((node) => node.nodeType === 3 ? node.data.trim() !== '' : isElement(node) && !['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE', 'TABLE', 'HR', 'FIGURE', 'PRE'].includes(node.nodeName));

        if (!junk && !stray && surface.firstElementChild) {
            return;
        }

        const range = getRange(surface);

        if (range) {
            insertMarkers(range);
        }

        for (const element of Array.from(surface.querySelectorAll('[style]'))) {
            element.removeAttribute('style');
        }

        for (const element of Array.from(surface.querySelectorAll('meta'))) {
            element.remove();
        }

        for (const element of Array.from(surface.querySelectorAll('font, span:not([data-ipx-rte-marker])'))) {
            unwrap(element);
        }

        const renames = { B: 'strong', I: 'em', STRIKE: 's', DEL: 's', INS: 'u', CENTER: 'p' };

        for (const element of Array.from(surface.querySelectorAll('b, i, strike, del, ins, center'))) {
            rename(element, renames[element.nodeName]);
        }

        for (const element of Array.from(surface.querySelectorAll('div')).reverse()) {
            if (element.querySelector('p, h1, h2, h3, h4, h5, h6, ul, ol, table, blockquote, pre, div') || element.closest('li, td, th, p')) {
                unwrap(element);
            } else {
                rename(element, 'p');
            }
        }

        for (const element of Array.from(surface.querySelectorAll('[class]'))) {
            const kept = classList(element).filter((name) => !name.startsWith('Apple-'));

            if (kept.length) {
                element.setAttribute('class', kept.join(' '));
            } else {
                element.removeAttribute('class');
            }
        }

        ensureStructure(surface);

        if (range) {
            restoreMarkers(surface);
        }
    }

    capture() {
        if (this.mode === 'rich') {
            const fragment = this.doc.createDocumentFragment();

            for (const child of this.surface.childNodes) {
                fragment.appendChild(child.cloneNode(true));
            }

            for (const image of fragment.querySelectorAll('[data-ipx-rte-selected]')) {
                image.removeAttribute('data-ipx-rte-selected');
            }

            const range = getRange(this.surface);
            const selection = range ? {
                start: nodePath(this.surface, range.startContainer),
                startOffset: range.startOffset,
                end: nodePath(this.surface, range.endContainer),
                endOffset: range.endOffset,
            } : null;

            return { mode: this.mode, format: this.format, key: `rich:${this.surface.innerHTML}`, fragment, selection };
        }

        return {
            mode: this.mode,
            format: this.format,
            key: `${this.mode}:${this.format}:${this.source.value}`,
            value: this.source.value,
            start: this.source.selectionStart,
            end: this.source.selectionEnd,
        };
    }

    restore(snapshot) {
        if (snapshot.mode !== this.mode || snapshot.format !== this.format) {
            this.showMode(snapshot.mode, snapshot.format);
        }

        if (snapshot.mode === 'rich') {
            this.markImage(null);
            this.surface.replaceChildren(snapshot.fragment.cloneNode(true));
            ensureStructure(this.surface);
            this.surface.focus({ preventScroll: true });

            let restored = false;

            if (snapshot.selection) {
                try {
                    const start = resolvePath(this.surface, snapshot.selection.start);
                    const end = resolvePath(this.surface, snapshot.selection.end);

                    if (start && end) {
                        const range = this.doc.createRange();
                        range.setStart(start, Math.min(snapshot.selection.startOffset, start.nodeType === 3 ? start.length : start.childNodes.length));
                        range.setEnd(end, Math.min(snapshot.selection.endOffset, end.nodeType === 3 ? end.length : end.childNodes.length));
                        setRange(range);
                        restored = true;
                    }
                } catch (error) {
                    restored = false;
                }
            }

            if (!restored) {
                placeCaretAtEnd(this.surface.lastElementChild || this.surface);
            }
        } else {
            this.source.value = snapshot.value;
            this.source.focus({ preventScroll: true });
            this.source.setSelectionRange(snapshot.start, snapshot.end);

            if (this.mode === 'code' && this.format === 'html') {
                this.scheduleNotice();
            }
        }

        this.sync();
        this.updateToolbar();
    }

    // -----------------------------------------------------------------------
    // Modes
    // -----------------------------------------------------------------------

    /** Show a mode's UI without converting anything. */
    showMode(mode, format) {
        this.mode = mode;
        this.format = format;
        this.preview = false;
        this.root.setAttribute('data-mode', mode);

        const rich = mode === 'rich';

        this.surface.hidden = !rich;
        this.source.hidden = rich;
        this.previewPane.hidden = true;
        this.tableBar.hidden = true;
        this.source.spellcheck = mode !== 'code';
        this.source.classList.toggle('ipx-rte__source--code', mode === 'code');
        this.notice.hidden = true;
        this.updatePlaceholder();
    }

    applyMode(mode, format, value, { focus = true } = {}) {
        this.showMode(mode, format);

        if (mode === 'rich') {
            const tree = toTree('html', value, this.policy, { document: this.doc }).root;
            this.surface.replaceChildren(...Array.from(tree.childNodes));
            ensureStructure(this.surface);
            this.updatePlaceholder();

            if (focus) {
                this.surface.focus({ preventScroll: true });
                placeCaretAtEnd(this.surface.lastElementChild || this.surface);
            }
        } else {
            this.source.value = value;

            if (mode === 'code' && format === 'html') {
                this.scheduleNotice();
            }

            if (focus) {
                this.source.focus({ preventScroll: true });
                this.source.setSelectionRange(0, 0);
            }
        }

        this.updateToolbar();
    }

    /** The current source text of the active mode. */
    currentSource() {
        return this.mode === 'rich' ? this.getValue() : normalizeNewlines(this.source.value);
    }

    async requestMode(target, { confirm = true } = {}) {
        if (this.locked || target === this.mode || !this.config.modes.includes(target)) {
            return false;
        }

        const fromMode = this.mode;
        const fromFormat = this.format;
        const value = this.currentSource();
        const targetFormat = target === 'code' ? fromFormat : MODE_FORMAT[target];
        let next = value;

        // Leaving the HTML source view: warn about markup that will be removed.
        if (fromMode === 'code' && fromFormat === 'html') {
            const inspection = inspectHtml(value, this.policy, { document: this.doc });

            if (inspection.lossy && confirm) {
                const accepted = await this.confirmLoss(target, [this.t('loss_unsupported', { items: inspection.items.slice(0, 12).join(', ') })]);

                if (!accepted) {
                    return false;
                }
            }
        }

        const cacheKey = `${fromFormat}->${targetFormat}`;
        const comparable = fromMode === 'code' && fromFormat === 'html' ? this.measure(value).value : (fromMode === 'rich' ? value : normalizeNewlines(value));

        if (target === 'code') {
            next = fromFormat === 'html' ? fromTree('html', toTree('html', value, this.policy, { document: this.doc }).root, { pretty: true }) : value;
        } else if (targetFormat !== fromFormat) {
            const cached = this.cache.get(cacheKey);

            if (cached && cached.when === comparable) {
                // Switching back without edits restores the original exactly.
                next = cached.restore;
            } else {
                const result = convert(fromFormat, targetFormat, value, this.policy, { document: this.doc });

                if (result.lossy && confirm) {
                    const accepted = await this.confirmLoss(target, result.reasons.map((reason) => this.t(reason)));

                    if (!accepted) {
                        return false;
                    }
                }

                next = result.value;
                this.pendingCache = { key: `${targetFormat}->${fromFormat}`, restore: comparable };
            }
        }

        this.history.record('change');
        this.history.seal();
        this.applyMode(target, targetFormat, next);

        if (this.pendingCache) {
            this.cache.set(this.pendingCache.key, { when: this.snapshotValue().value, restore: this.pendingCache.restore });
            this.pendingCache = null;
        }

        this.history.record('mode');
        this.history.seal();
        this.sync();
        this.emit('mode-change', { mode: target, format: targetFormat, previousMode: fromMode });

        return true;
    }

    async confirmLoss(target, reasons) {
        const dialog = this.dialog('confirm', () => new ConfirmDialog(this));
        const result = await dialog.show(this.t('convert_lossy', { mode: this.t(`mode_${target}`) }), reasons);

        this.focus();

        return !!result;
    }

    togglePreview() {
        if (this.mode !== 'markdown') {
            return;
        }

        this.preview = !this.preview;
        this.source.hidden = this.preview;
        this.previewPane.hidden = !this.preview;

        if (this.preview) {
            this.renderPreview();
        } else {
            this.source.focus();
        }

        this.updateToolbar();
    }

    renderPreview() {
        const tree = toTree('markdown', this.source.value, this.policy, { document: this.doc }).root;

        if (tree.childNodes.length) {
            this.previewPane.replaceChildren(...Array.from(tree.childNodes));
        } else {
            this.previewPane.replaceChildren(el(this.doc, 'p', { className: 'ipx-rte__preview-empty', text: this.t('preview_empty') }));
        }
    }

    scheduleNotice() {
        clearTimeout(this.noticeTimer);
        this.noticeTimer = setTimeout(() => {
            if (this.mode !== 'code' || this.format !== 'html') {
                this.notice.hidden = true;
                return;
            }

            const inspection = inspectHtml(this.source.value, this.policy, { document: this.doc });

            this.notice.textContent = inspection.lossy ? this.t('source_notice', { items: inspection.items.slice(0, 12).join(', ') }) : '';
            this.notice.hidden = !inspection.lossy;
        }, 300);
    }

    // -----------------------------------------------------------------------
    // Commands
    // -----------------------------------------------------------------------

    focusSurface() {
        if (this.doc.activeElement !== this.surface) {
            this.surface.focus({ preventScroll: true });
        }

        if (!getRange(this.surface)) {
            if (this.lastRange && this.surface.contains(this.lastRange.startContainer)) {
                setRange(this.lastRange);
            } else {
                caretRange(this.surface);
            }
        }
    }

    command(name, argument) {
        if (this.locked || this.destroyed) {
            return;
        }

        if (name === 'undo' || name === 'redo') {
            this.history[name]();
            return;
        }

        if (this.mode === 'rich') {
            this.richCommand(name, argument);
        } else if (this.mode === 'markdown' && !this.preview && (MARKDOWN_COMMANDS.has(name) || name === 'block')) {
            this.markdownCommand(name, argument);
        }
    }

    richCommand(name, argument) {
        const surface = this.surface;

        this.focusSurface();
        this.history.seal();

        if (MARK_TAGS[name]) {
            const result = toggleMark(surface, MARK_TAGS[name], this.state);

            if (result === 'pending') {
                this.updateToolbar();
                return;
            }

            if (result) {
                this.afterChange('change');
            }

            return;
        }

        if (TABLE_COMMANDS.includes(name)) {
            this.tableCommand(name);
            return;
        }

        let changed = true;

        switch (name) {
            case 'block':
                if (argument === 'pre') {
                    changed = toggleCodeBlock(surface);
                } else {
                    changed = setBlockType(surface, argument);
                }

                break;
            case 'paragraph':
                changed = setBlockType(surface, 'p');
                break;
            case 'bullet_list':
                changed = toggleList(surface, 'UL');
                break;
            case 'ordered_list':
                changed = toggleList(surface, 'OL');
                break;
            case 'indent':
                changed = changeIndent(surface, 1, this.config.maxIndent);
                break;
            case 'outdent':
                changed = changeIndent(surface, -1, this.config.maxIndent);
                break;
            case 'align_left':
            case 'align_center':
            case 'align_right':
            case 'align_justify':
                changed = this.selectedImage ? this.alignImage(name.slice(6)) : setAlignment(surface, name.slice(6));
                break;
            case 'blockquote':
                changed = toggleBlockquote(surface);
                break;
            case 'code_block':
                changed = toggleCodeBlock(surface);
                break;
            case 'horizontal_rule':
                insertHorizontalRule(surface);
                break;
            case 'unlink':
                changed = removeLink(surface);
                break;
            case 'clear_formatting':
                changed = clearFormatting(surface, this.state);
                break;
            case 'link':
                this.openLinkDialog();
                return;
            case 'image':
                this.openImageDialog();
                return;
            case 'file':
                this.openFileDialog();
                return;
            case 'table':
                this.openTableDialog();
                return;
            default:
                return;
        }

        if (changed) {
            this.afterChange('change');
        } else {
            this.updateToolbar();
        }
    }

    tableCommand(name) {
        const context = tableContext(this.surface, getRange(this.surface) || this.lastRange);

        if (!context) {
            return;
        }

        switch (name) {
            case 'row_above':
                addRow(context, false);
                break;
            case 'row_below':
                addRow(context, true);
                break;
            case 'delete_row':
                deleteRow(this.surface, context);
                break;
            case 'column_left':
                addColumn(context, false);
                break;
            case 'column_right':
                addColumn(context, true);
                break;
            case 'delete_column':
                deleteColumn(this.surface, context);
                break;
            case 'header_row':
                toggleHeaderRow(context);
                break;
            case 'delete_table':
                deleteTable(this.surface, context);
                break;
            case 'table_design':
                this.openTableDesignDialog(context);
                return;
            default:
                return;
        }

        this.afterChange('change');
    }

    markdownCommand(name, argument) {
        const textarea = this.source;

        textarea.focus();
        this.history.seal();

        switch (name) {
            case 'bold':
                wrapInline(textarea, '**');
                break;
            case 'italic':
                wrapInline(textarea, '*');
                break;
            case 'strikethrough':
                wrapInline(textarea, '~~');
                break;
            case 'inline_code':
                inlineCode(textarea);
                break;
            case 'block':
                if (argument === 'pre') {
                    codeBlock(textarea);
                } else {
                    toggleLinePrefix(textarea, argument === 'p' ? 'paragraph' : `${'#'.repeat(Number(argument.slice(1)))} `);
                }

                break;
            case 'paragraph':
                toggleLinePrefix(textarea, 'paragraph');
                break;
            case 'bullet_list':
                toggleLinePrefix(textarea, 'bullet');
                break;
            case 'ordered_list':
                toggleLinePrefix(textarea, 'ordered');
                break;
            case 'blockquote':
                toggleLinePrefix(textarea, 'quote');
                break;
            case 'code_block':
                codeBlock(textarea);
                break;
            case 'horizontal_rule':
                insertMarkdownBlock(textarea, '---');
                break;
            case 'link':
                this.openLinkDialog();
                return;
            case 'image':
                this.openImageDialog();
                return;
            case 'file':
                this.openFileDialog();
                return;
            case 'table':
                this.openTableDialog();
                return;
            default:
                return;
        }

        this.afterChange('change');
    }

    dialog(name, factory) {
        if (!this.dialogCache.has(name)) {
            this.dialogCache.set(name, factory());
        }

        return this.dialogCache.get(name);
    }

    trackDialog(element) {
        this.dialogElements.add(element);
    }

    saveSelection() {
        if (this.mode === 'rich') {
            const range = getRange(this.surface) || this.lastRange || caretRange(this.surface);

            return { range: range ? range.cloneRange() : null };
        }

        return { start: this.source.selectionStart, end: this.source.selectionEnd };
    }

    restoreSelection(saved) {
        if (this.mode === 'rich') {
            this.surface.focus({ preventScroll: true });

            if (saved.range && this.surface.contains(saved.range.startContainer)) {
                setRange(saved.range);
            } else {
                caretRange(this.surface);
            }

            return getRange(this.surface);
        }

        this.source.focus({ preventScroll: true });
        this.source.setSelectionRange(saved.start, saved.end);

        return null;
    }

    async openLinkDialog() {
        const saved = this.saveSelection();
        const dialog = this.dialog('link', () => new LinkDialog(this));
        let link = null;
        let values;

        if (this.mode === 'rich') {
            link = saved.range ? linkAtSelection(this.surface, saved.range) : null;
            values = link
                ? { href: link.getAttribute('href') || '', text: link.textContent, newTab: link.getAttribute('target') === '_blank', editing: true, showText: true }
                : { href: '', text: saved.range ? saved.range.toString() : '', showText: !saved.range || saved.range.collapsed };
        } else {
            const text = selectedText(this.source);
            values = { href: '', text, showText: true };
        }

        const result = await dialog.show(values);
        const range = this.restoreSelection(saved);

        if (!result) {
            return;
        }

        if (this.mode === 'rich') {
            if (result.remove) {
                if (link && link.isConnected) {
                    unwrap(link);
                } else {
                    removeLink(this.surface);
                }
            } else {
                applyLink(this.surface, range, { ...result, link });
            }
        } else {
            const text = result.text || result.href;
            insertInline(this.source, `[${escapeLinkText(text)}](${markdownUrl(result.href)})`);
        }

        this.afterChange('change');
    }

    imageValues(image) {
        const figure = image.closest('figure');
        const classes = classList(image).concat(figure ? classList(figure) : []);
        const values = {
            src: image.getAttribute('src') || '',
            alt: image.getAttribute('alt') ?? '',
            title: image.getAttribute('title') || '',
            caption: figure && figure.querySelector('figcaption') ? figure.querySelector('figcaption').textContent : '',
            classes: [],
            customClasses: [],
            alignment: '',
            display: classes.includes('ipx-rte-img--block') ? 'block' : 'inline',
        };

        for (const name of classes) {
            const width = /^ipx-rte-w-(\d+)$/.exec(name);
            const height = /^ipx-rte-h-(\d+)$/.exec(name);
            const align = /^ipx-rte-img-(left|center|right)$/.exec(name);

            if (width) {
                values.width = { unit: '%', value: Number(width[1]) };
            } else if (height) {
                values.height = { unit: '%', value: Number(height[1]) };
            } else if (align) {
                values.alignment = align[1];
            } else if (this.config.images.classes && Object.prototype.hasOwnProperty.call(this.config.images.classes, name)) {
                values.classes.push(name);
            } else if (!name.startsWith('ipx-rte')) {
                values.customClasses.push(name);
            }
        }

        if (image.getAttribute('width')) {
            values.width = { unit: 'px', value: Number(image.getAttribute('width')) };
        }

        if (image.getAttribute('height')) {
            values.height = { unit: 'px', value: Number(image.getAttribute('height')) };
        }

        return values;
    }

    buildImage(values) {
        const doc = this.doc;
        const image = doc.createElement('img');
        const layout = [];
        const styles = [...values.classes, ...values.customClasses];

        image.setAttribute('src', values.src);
        image.setAttribute('alt', values.alt || '');

        if (values.title) {
            image.setAttribute('title', values.title);
        }

        for (const [dimension, prefix] of [['width', 'w'], ['height', 'h']]) {
            const value = values[dimension];

            if (!value) {
                continue;
            }

            if (value.unit === 'px') {
                image.setAttribute(dimension, String(value.value));
            } else {
                (dimension === 'width' ? layout : styles).push(`ipx-rte-${prefix}-${value.value}`);
            }
        }

        if (values.alignment) {
            layout.push(`ipx-rte-img-${values.alignment}`);
        }

        if (values.caption) {
            const figure = doc.createElement('figure');
            figure.setAttribute('class', ['ipx-rte-figure', ...layout].join(' '));

            if (styles.length) {
                image.setAttribute('class', styles.join(' '));
            }

            figure.appendChild(image);
            figure.appendChild(el(doc, 'figcaption', { text: values.caption }));

            return figure;
        }

        const classes = [...styles, ...layout];

        if (values.display === 'block' && !values.alignment) {
            classes.push('ipx-rte-img--block');
        }

        if (classes.length) {
            image.setAttribute('class', classes.join(' '));
        }

        return image;
    }

    async openImageDialog({ file = null } = {}) {
        if (!this.config.images.enabled) {
            return;
        }

        const saved = this.saveSelection();
        const editing = this.mode === 'rich' && this.selectedImage && this.surface.contains(this.selectedImage) ? this.selectedImage : null;
        const dialog = this.dialog('image', () => new ImageDialog(this));
        const markdown = this.mode === 'markdown';
        const result = await dialog.show({
            values: editing ? this.imageValues(editing) : { alt: markdown ? selectedText(this.source) : '' },
            editing: !!editing,
            markdown,
            file,
        });
        const range = this.restoreSelection(saved);

        if (!result) {
            return;
        }

        // Re-sanitize everything that came from the dialog.
        if (this.mode === 'markdown') {
            insertInline(this.source, `![${escapeLinkText(result.alt)}](${markdownUrl(result.src)}${markdownTitle(result.title)})`);
            this.afterChange('change');

            return;
        }

        const built = this.buildImage(result);
        const holder = this.doc.createElement('div');
        const wrapper = this.doc.createElement('p');
        wrapper.appendChild(built);
        holder.appendChild(built.nodeName === 'FIGURE' ? built : wrapper);

        const clean = importHtml(holder, this.policy, { document: this.doc }).fragment;
        const element = clean.querySelector('figure, img');

        if (!element) {
            return;
        }

        if (editing && editing.isConnected) {
            const target = editing.closest('figure') || editing;

            if (element.nodeName === 'FIGURE' && target.nodeName !== 'FIGURE') {
                // An inline image gained a caption: move it out of its paragraph.
                const block = textBlockOf(target, this.surface);
                target.remove();
                const range = this.doc.createRange();

                range.selectNodeContents(block || this.surface);
                range.collapse(false);
                insertBlock(this.surface, range, element);
            } else if (element.nodeName !== 'FIGURE' && target.nodeName === 'FIGURE') {
                const paragraph = this.doc.createElement('p');
                paragraph.appendChild(element);
                target.parentNode.replaceChild(paragraph, target);
            } else {
                target.parentNode.replaceChild(element, target);
            }

            this.selectImage(element.nodeName === 'IMG' ? element : element.querySelector('img'));
        } else if (element.nodeName === 'FIGURE') {
            insertBlock(this.surface, range || caretRange(this.surface), element);
        } else {
            insertFragment(this.surface, range || caretRange(this.surface), clean);
        }

        this.afterChange('change');
    }

    alignImage(alignment) {
        const image = this.selectedImage;

        if (!image) {
            return false;
        }

        const target = image.closest('figure') || image;
        const current = classList(target).find((name) => /^ipx-rte-img-(left|center|right)$/.test(name));
        const classes = classList(target).filter((name) => !/^ipx-rte-img-(left|center|right)$/.test(name));
        const wanted = alignment === 'justify' ? null : `ipx-rte-img-${alignment}`;

        if (wanted && current !== wanted) {
            classes.push(wanted);
        }

        target.setAttribute('class', classes.join(' '));

        if (!target.getAttribute('class')) {
            target.removeAttribute('class');
        }

        return true;
    }

    removeSelectedImage() {
        const image = this.selectedImage;
        const target = image.closest('figure') || image;
        const block = textBlockOf(target, this.surface);

        this.markImage(null);
        target.remove();

        if (block && block.isConnected) {
            placeCaretAtEnd(block);
        } else {
            caretRange(this.surface);
        }

        this.afterChange('change');
    }

    async openFileDialog({ file = null } = {}) {
        if (!this.config.files.enabled) {
            return;
        }

        const saved = this.saveSelection();
        const dialog = this.dialog('file', () => new FileDialog(this));
        const result = await dialog.show({ file });
        const range = this.restoreSelection(saved);

        if (!result) {
            return;
        }

        if (this.mode === 'markdown') {
            insertInline(this.source, `[${escapeLinkText(result.text)}](${markdownUrl(result.url)})`);
            this.afterChange('change');

            return;
        }

        const link = el(this.doc, 'a', { href: result.url, className: 'ipx-rte-attachment', text: result.text });
        const holder = this.doc.createElement('div');
        holder.appendChild(el(this.doc, 'p', null, [link]));

        insertFragment(this.surface, range || caretRange(this.surface), importHtml(holder, this.policy, { document: this.doc }).fragment);
        this.afterChange('change');
    }

    async openTableDialog() {
        if (!this.config.tables.enabled) {
            return;
        }

        const saved = this.saveSelection();
        const dialog = this.dialog('table', () => new TableDialog(this));
        const result = await dialog.show();
        const range = this.restoreSelection(saved);

        if (!result) {
            return;
        }

        if (this.mode === 'markdown') {
            const skeleton = tableSkeleton(result.columns, result.rows, result.header);
            insertMarkdownBlock(this.source, skeleton, 2, 0);
            this.afterChange('change');

            return;
        }

        const table = createTable(this.doc, result.rows, result.columns, { header: result.header, presets: result.presets });

        insertBlock(this.surface, range || caretRange(this.surface), table);

        const first = table.querySelector('th, td');

        if (first) {
            placeCaretAtEnd(first);
        }

        this.afterChange('change');
    }

    async openTableDesignDialog(context) {
        const saved = this.saveSelection();
        const dialog = this.dialog('table-design', () => new TableDesignDialog(this));
        const result = await dialog.show(tablePresets(context.table));

        this.restoreSelection(saved);

        if (!result || !context.table.isConnected) {
            return;
        }

        setTablePresets(context.table, result.filter((preset) => Object.prototype.hasOwnProperty.call(this.config.tables.presets, preset)));
        this.afterChange('change');
    }

    // -----------------------------------------------------------------------
    // Toolbar state
    // -----------------------------------------------------------------------

    updateToolbar() {
        if (!this.toolbar || this.destroyed) {
            return;
        }

        const enabled = new Set(['undo', 'redo']);
        const pressed = new Set();
        let block = 'p';

        if (this.mode === 'rich') {
            const range = getRange(this.surface) || (this.lastRange && this.surface.contains(this.lastRange.startContainer) ? this.lastRange : null);

            for (const name of this.config.toolbar) {
                enabled.add(name);
            }

            if (range) {
                const inPre = !!closestTag(range.startContainer, 'PRE', this.surface);

                for (const [name, tag] of Object.entries(MARK_TAGS)) {
                    const active = isMarkActive(this.surface, range, tag);

                    if (active !== this.state.pendingMarks.has(tag)) {
                        pressed.add(name);
                    }

                    if (inPre) {
                        enabled.delete(name);
                    }
                }

                block = currentBlockType(this.surface, range);

                const list = currentListType(this.surface, range);

                if (list === 'UL') {
                    pressed.add('bullet_list');
                } else if (list === 'OL') {
                    pressed.add('ordered_list');
                }

                const alignment = currentAlignment(this.surface, range);

                if (alignment) {
                    pressed.add(`align_${alignment}`);
                }

                if (closestTag(range.startContainer, 'BLOCKQUOTE', this.surface)) {
                    pressed.add('blockquote');
                }

                if (block === 'pre') {
                    pressed.add('code_block');

                    for (const name of ['link', 'image', 'file', 'table', 'align_left', 'align_center', 'align_right', 'align_justify', 'clear_formatting']) {
                        enabled.delete(name);
                    }
                }

                const link = linkAtSelection(this.surface, range);

                if (link) {
                    pressed.add('link');
                } else {
                    enabled.delete('unlink');
                }

                if (closestTag(range.startContainer, new Set(['TD', 'TH']), this.surface)) {
                    for (const name of ['table', 'blockquote', 'code_block', 'horizontal_rule', 'bullet_list', 'ordered_list']) {
                        enabled.delete(name);
                    }
                }
            } else {
                enabled.delete('unlink');
            }

            this.updateTableBar(range);
        } else if (this.mode === 'markdown' && !this.preview) {
            for (const name of this.config.toolbar) {
                if (MARKDOWN_COMMANDS.has(name)) {
                    enabled.add(name);
                }
            }

            block = this.markdownBlock();
            this.tableBar.hidden = true;
        } else {
            this.tableBar.hidden = true;
        }

        if (this.preview) {
            enabled.clear();
        }

        this.toolbar.update({
            mode: this.mode,
            enabled,
            pressed,
            block,
            canUndo: this.history ? this.history.canUndo() : false,
            canRedo: this.history ? this.history.canRedo() : false,
            preview: this.preview,
            locked: this.locked,
        });
    }

    markdownBlock() {
        const { value, selectionStart } = this.source;
        const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
        const match = /^ {0,3}(#{1,6}) /.exec(value.slice(lineStart, lineStart + 10));

        return match ? `h${match[1].length}` : 'p';
    }

    updateTableBar(range) {
        const context = range ? tableContext(this.surface, range) : null;

        this.tableBar.hidden = !context || this.locked;

        if (context && this.tableButtons) {
            const header = this.tableButtons.get('header_row');

            if (header) {
                header.setAttribute('aria-pressed', context.table.tHead ? 'true' : 'false');
            }
        }
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    emit(name, detail = {}) {
        this.root.dispatchEvent(new CustomEvent(`ipx-rte:${name}`, { bubbles: true, detail: { editor: this, ...detail } }));
    }

    getFormat() {
        return this.format;
    }

    getMode() {
        return this.mode;
    }

    getCharacterCount() {
        return this.snapshotValue().count;
    }

    setMode(mode, options = {}) {
        return this.requestMode(mode, options);
    }

    setValue(value, format = this.format, { resetHistory = false } = {}) {
        const target = this.config.modes.includes(this.mode) && (this.mode === 'code' ? this.format === format : MODE_FORMAT[this.mode] === format)
            ? this.mode
            : this.initialMode(format);

        this.cache.clear();
        this.load(format, value, target);

        if (resetHistory) {
            this.history.reset();
        } else {
            this.history.record('change');
        }

        this.showClientError(null);
        this.sync();
    }

    focus() {
        if (this.mode === 'rich') {
            this.focusSurface();
        } else if (this.preview) {
            this.previewPane.focus();
        } else {
            this.source.focus();
        }
    }

    destroy() {
        if (this.destroyed) {
            return;
        }

        this.sync();
        this.destroyed = true;
        this.abort.abort();
        clearTimeout(this.syncTimer);
        clearTimeout(this.noticeTimer);
        this.counter.destroy();

        for (const dialog of this.dialogElements) {
            dialog.remove();
        }

        for (const element of [this.toolbar.element, this.tableBar, this.body, this.notice, this.footer, this.clientError, this.counter.live]) {
            element.remove();
        }

        if (this.removedRequired) {
            this.field.setAttribute('required', '');
        }

        this.root.classList.remove('ipx-rte--ready', 'ipx-rte--focused');
        this.root.removeAttribute('data-mode');

        if (this.hooks.onDestroy) {
            this.hooks.onDestroy(this);
        }

        this.emit('destroy');
    }
}
