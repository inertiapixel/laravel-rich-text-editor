/**
 * Toolbar and mode switcher for one editor (role="toolbar" with a roving
 * tabindex: Tab enters the toolbar once, arrow keys move inside it).
 */

import { el } from './dom.js';
import { createIcon } from './icons.js';

const TOGGLES = new Set([
    'bold', 'italic', 'underline', 'strikethrough', 'inline_code', 'bullet_list', 'ordered_list',
    'align_left', 'align_center', 'align_right', 'align_justify', 'blockquote', 'code_block', 'link',
]);

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');

export function shortcutLabel(shortcut) {
    return shortcut
        .split('+')
        .map((part) => (part === 'Mod' ? (IS_MAC ? '⌘' : 'Ctrl') : part === 'Alt' && IS_MAC ? '⌥' : part === 'Shift' && IS_MAC ? '⇧' : part))
        .join(IS_MAC ? '' : '+');
}

export function ariaShortcut(shortcut) {
    return shortcut
        .split('+')
        .map((part) => (part === 'Mod' ? (IS_MAC ? 'Meta' : 'Control') : part))
        .join('+');
}

export class Toolbar {
    constructor(editor) {
        this.editor = editor;
        this.doc = editor.doc;
        this.t = editor.t;
        this.items = new Map();
        this.element = el(this.doc, 'div', {
            className: 'ipx-rte__toolbar',
            role: 'toolbar',
            'aria-label': this.t('toolbar_label'),
            'aria-controls': editor.surfaceId,
        });

        this.build();
    }

    build() {
        const config = this.editor.config;
        let group = null;

        const newGroup = () => {
            group = el(this.doc, 'div', { className: 'ipx-rte__group', role: 'group' });
            this.element.appendChild(group);
        };

        for (const name of config.toolbar) {
            if (name === '|') {
                group = null;
                continue;
            }

            if (!group) {
                newGroup();
            }

            const control = name === 'heading' ? this.blockSelect() : this.button(name);
            group.appendChild(control);
            this.items.set(name, control);
        }

        if (config.modes.length > 1 || config.markdownPreview) {
            this.modes = el(this.doc, 'div', { className: 'ipx-rte__modes', role: 'group', 'aria-label': this.t('modes_label') });
            this.modeButtons = new Map();

            if (config.modes.length > 1) {
                for (const mode of config.modes) {
                    const button = el(this.doc, 'button', {
                        type: 'button',
                        className: 'ipx-rte__mode',
                        'data-mode': mode,
                        'aria-pressed': 'false',
                        tabindex: '-1',
                        text: this.t(`mode_${mode}`),
                    });
                    button.addEventListener('click', () => this.editor.requestMode(mode));
                    this.modeButtons.set(mode, button);
                    this.modes.appendChild(button);
                }
            }

            if (config.modes.includes('markdown') && config.markdownPreview) {
                this.previewButton = el(this.doc, 'button', {
                    type: 'button',
                    className: 'ipx-rte__mode ipx-rte__mode--preview',
                    'aria-pressed': 'false',
                    tabindex: '-1',
                    hidden: true,
                    text: this.t('preview'),
                });
                this.previewButton.addEventListener('click', () => this.editor.togglePreview());
                this.modes.appendChild(this.previewButton);
            }

            if (this.modes.childNodes.length) {
                this.element.appendChild(this.modes);
            }
        }

        this.element.addEventListener('mousedown', (event) => {
            // Keep the editor selection when clicking toolbar buttons.
            if (event.target.closest('button')) {
                event.preventDefault();
            }
        });
        this.element.addEventListener('keydown', (event) => this.onKeydown(event));

        const first = this.focusable()[0];

        if (first) {
            first.tabIndex = 0;
        }
    }

    button(name) {
        const label = this.t(name);
        const shortcut = this.editor.config.shortcuts[name];
        const button = el(this.doc, 'button', {
            type: 'button',
            className: `ipx-rte__button ipx-rte__button--${name.replace(/_/g, '-')}`,
            'data-command': name,
            'aria-label': label,
            title: shortcut ? `${label} (${shortcutLabel(shortcut)})` : label,
            tabindex: '-1',
        });

        if (TOGGLES.has(name)) {
            button.setAttribute('aria-pressed', 'false');
        }

        if (shortcut) {
            button.setAttribute('aria-keyshortcuts', ariaShortcut(shortcut));
        }

        const icon = createIcon(this.doc, name);

        if (icon) {
            button.appendChild(icon);
        } else {
            button.textContent = label;
        }

        button.addEventListener('click', () => this.editor.command(name));

        return button;
    }

    blockSelect() {
        const select = el(this.doc, 'select', {
            className: 'ipx-rte__select',
            'aria-label': this.t('block_format'),
            tabindex: '-1',
        });

        select.appendChild(el(this.doc, 'option', { value: 'p', text: this.t('paragraph') }));

        for (const level of this.editor.config.headings) {
            select.appendChild(el(this.doc, 'option', { value: `h${level}`, text: this.t('heading', { level }) }));
        }

        select.appendChild(el(this.doc, 'option', { value: 'pre', text: this.t('code_block'), hidden: true, disabled: true }));
        select.addEventListener('change', () => this.editor.command('block', select.value));

        return select;
    }

    focusable() {
        return Array.from(this.element.querySelectorAll('button, select')).filter((control) => !control.hidden && !control.closest('[hidden]'));
    }

    onKeydown(event) {
        const controls = this.focusable().filter((control) => !control.disabled);
        const index = controls.indexOf(this.doc.activeElement);

        if (index === -1) {
            return;
        }

        let next = null;

        if (event.key === 'ArrowRight' || (event.key === 'ArrowDown' && this.doc.activeElement.nodeName !== 'SELECT')) {
            next = controls[(index + 1) % controls.length];
        } else if (event.key === 'ArrowLeft' || (event.key === 'ArrowUp' && this.doc.activeElement.nodeName !== 'SELECT')) {
            next = controls[(index - 1 + controls.length) % controls.length];
        } else if (event.key === 'Home') {
            next = controls[0];
        } else if (event.key === 'End') {
            next = controls[controls.length - 1];
        } else if (event.key === 'Escape') {
            event.preventDefault();
            this.editor.focus();
            return;
        }

        if (next) {
            event.preventDefault();
            this.focusControl(next);
        }
    }

    focusControl(control) {
        for (const item of this.focusable()) {
            item.tabIndex = -1;
        }

        control.tabIndex = 0;
        control.focus();
    }

    focusFirst() {
        const current = this.focusable().find((control) => control.tabIndex === 0 && !control.disabled) || this.focusable().find((control) => !control.disabled);

        if (current) {
            this.focusControl(current);
        }
    }

    /**
     * @param {object} state { mode, enabled: Set, pressed: Set, block, canUndo, canRedo, preview, locked }
     */
    update(state) {
        for (const [name, control] of this.items) {
            const enabled = !state.locked && state.enabled.has(name) && (name !== 'undo' || state.canUndo) && (name !== 'redo' || state.canRedo);

            control.disabled = !enabled;

            if (control.hasAttribute('aria-pressed')) {
                control.setAttribute('aria-pressed', state.pressed.has(name) ? 'true' : 'false');
            }

            if (control.nodeName === 'SELECT') {
                const option = control.querySelector('option[value="pre"]');
                option.hidden = state.block !== 'pre';

                if (control.value !== state.block) {
                    control.value = state.block;
                }
            }
        }

        if (this.modeButtons) {
            for (const [mode, button] of this.modeButtons) {
                button.setAttribute('aria-pressed', mode === state.mode ? 'true' : 'false');
                button.disabled = !!state.locked;
            }
        }

        if (this.previewButton) {
            this.previewButton.hidden = state.mode !== 'markdown';
            this.previewButton.setAttribute('aria-pressed', state.preview ? 'true' : 'false');
            this.previewButton.textContent = this.t(state.preview ? 'write' : 'preview');
            this.previewButton.disabled = !!state.locked && !state.readonlyPreview;
        }

        // Keep exactly one tabbable control.
        const controls = this.focusable();

        if (!controls.some((control) => control.tabIndex === 0 && !control.disabled)) {
            for (const control of controls) {
                control.tabIndex = -1;
            }

            const first = controls.find((control) => !control.disabled);

            if (first) {
                first.tabIndex = 0;
            }
        }
    }
}
