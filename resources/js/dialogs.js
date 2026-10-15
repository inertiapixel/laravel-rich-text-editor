/**
 * Package-owned modal dialogs built on <dialog>. Dialogs are appended to
 * <body> (outside the host form, so their fields are never submitted and
 * Enter never submits the host form) and removed when the editor is
 * destroyed. All markup is created with DOM APIs.
 */

import { el, uniqueId } from './dom.js';
import { SUPPORTED_PERCENTS, isCustomClass, safeUrl } from './serializer.js';
import { formatBytes, uploadFile, validateFile } from './upload.js';

class Dialog {
    constructor(editor, title, { wide = false } = {}) {
        this.editor = editor;
        this.doc = editor.doc;
        this.t = editor.t;
        this.resolve = null;
        this.titleId = uniqueId('ipx-rte-dialog-title');

        const classes = ['ipx-rte-dialog'];

        if (wide) {
            classes.push('ipx-rte-dialog--wide');
        }

        if (editor.themeClass) {
            classes.push(editor.themeClass);
        }

        this.dialog = el(this.doc, 'dialog', { className: classes.join(' '), 'aria-labelledby': this.titleId });
        this.form = el(this.doc, 'form', { method: 'dialog', className: 'ipx-rte-dialog__form', novalidate: true });
        this.heading = el(this.doc, 'h2', { className: 'ipx-rte-dialog__title', id: this.titleId, text: title });
        this.body = el(this.doc, 'div', { className: 'ipx-rte-dialog__body' });
        this.footer = el(this.doc, 'div', { className: 'ipx-rte-dialog__footer' });
        this.error = el(this.doc, 'p', { className: 'ipx-rte-dialog__alert', role: 'alert', hidden: true });

        this.cancelButton = this.button(this.t('cancel'), 'secondary');
        this.confirmButton = el(this.doc, 'button', { type: 'submit', className: 'ipx-rte-dialog__button ipx-rte-dialog__button--primary', text: this.t('insert') });

        this.footer.append(this.cancelButton, this.confirmButton);
        this.form.append(this.heading, this.body, this.error, this.footer);
        this.dialog.appendChild(this.form);

        this.cancelButton.addEventListener('click', () => this.close(null));
        this.form.addEventListener('submit', (event) => {
            event.preventDefault();
            this.submit();
        });
        this.dialog.addEventListener('cancel', (event) => {
            event.preventDefault();

            if (!this.busy) {
                this.close(null);
            }
        });
        this.dialog.addEventListener('keydown', (event) => {
            event.stopPropagation();

            // Enter submits from any input. Safari does not submit from
            // checkboxes and does not focus them on click, so Enter may
            // also arrive on the dialog itself.
            const target = event.target;
            const own = target === this.dialog || target === this.form || (target.nodeName === 'INPUT' && !['file', 'button', 'submit', 'reset'].includes(target.type));

            if (event.key === 'Enter' && own && !event.isComposing) {
                event.preventDefault();
                this.submit();
            }
        });
    }

    button(text, variant) {
        return el(this.doc, 'button', { type: 'button', className: `ipx-rte-dialog__button ipx-rte-dialog__button--${variant}`, text });
    }

    field(label, control, { help, inline = false } = {}) {
        const id = control.id || uniqueId('ipx-rte-field');
        control.id = id;

        const wrapper = el(this.doc, 'div', { className: inline ? 'ipx-rte-dialog__field ipx-rte-dialog__field--inline' : 'ipx-rte-dialog__field' });
        const labelElement = el(this.doc, 'label', { className: 'ipx-rte-dialog__label', for: id, text: label });
        const message = el(this.doc, 'p', { className: 'ipx-rte-dialog__error', id: `${id}-error`, hidden: true });

        if (inline) {
            wrapper.append(control, labelElement);
        } else {
            wrapper.append(labelElement, control);
        }

        if (help) {
            const helpElement = el(this.doc, 'p', { className: 'ipx-rte-dialog__help', id: `${id}-help`, text: help });
            control.setAttribute('aria-describedby', helpElement.id);
            wrapper.appendChild(helpElement);
        }

        wrapper.appendChild(message);
        control.ipxError = message;

        return wrapper;
    }

    input(attrs) {
        return el(this.doc, 'input', { className: 'ipx-rte-dialog__input', ...attrs });
    }

    select(options, value) {
        const select = el(this.doc, 'select', { className: 'ipx-rte-dialog__input' });

        for (const [optionValue, label] of options) {
            const option = el(this.doc, 'option', { value: optionValue, text: label });

            if (String(optionValue) === String(value)) {
                option.selected = true;
            }

            select.appendChild(option);
        }

        return select;
    }

    setError(control, message) {
        const target = control.ipxError;

        if (!target) {
            return;
        }

        target.textContent = message || '';
        target.hidden = !message;

        if (message) {
            control.setAttribute('aria-invalid', 'true');
            const described = (control.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);

            if (!described.includes(target.id)) {
                described.push(target.id);
            }

            control.setAttribute('aria-describedby', described.join(' '));
        } else {
            control.removeAttribute('aria-invalid');
        }
    }

    showAlert(message) {
        this.error.textContent = message || '';
        this.error.hidden = !message;
    }

    open() {
        if (!this.dialog.isConnected) {
            this.doc.body.appendChild(this.dialog);
            this.editor.trackDialog(this.dialog);
        }

        this.previousFocus = this.doc.activeElement;
        this.showAlert('');

        if (typeof this.dialog.showModal === 'function') {
            this.dialog.showModal();
        } else {
            this.dialog.setAttribute('open', '');
        }

        const first = this.form.querySelector('input:not([type=hidden]):not([disabled]):not([hidden]), select, textarea');

        if (first) {
            first.focus();
        }

        return new Promise((resolve) => {
            this.resolve = resolve;
        });
    }

    close(result) {
        if (typeof this.dialog.close === 'function' && this.dialog.open) {
            this.dialog.close();
        } else {
            this.dialog.removeAttribute('open');
        }

        const resolve = this.resolve;
        this.resolve = null;

        if (resolve) {
            resolve(result);
        }
    }

    setBusy(busy) {
        this.busy = busy;
        this.confirmButton.disabled = busy;
        this.cancelButton.disabled = busy;
    }

    submit() {
        this.close(true);
    }
}

// ---------------------------------------------------------------------------

export class LinkDialog extends Dialog {
    constructor(editor) {
        super(editor, editor.t('link_title'));

        this.url = this.input({ type: 'text', inputmode: 'url', autocomplete: 'off', spellcheck: 'false' });
        this.text = this.input({ type: 'text' });
        this.newTab = this.input({ type: 'checkbox', className: 'ipx-rte-dialog__checkbox' });
        this.removeButton = this.button(this.t('remove'), 'danger');

        this.textField = this.field(this.t('link_text'), this.text);
        this.body.append(this.field(this.t('link_url'), this.url), this.textField);

        if (editor.config.links.allowNewTab) {
            this.body.appendChild(this.field(this.t('link_new_tab'), this.newTab, { inline: true }));
        }

        this.footer.insertBefore(this.removeButton, this.footer.firstChild);
        this.removeButton.addEventListener('click', () => this.close({ remove: true }));
    }

    show({ href = '', text = '', newTab = false, editing = false, showText = true }) {
        this.url.value = href;
        this.text.value = text;
        this.newTab.checked = newTab;
        this.textField.hidden = !showText;
        this.removeButton.hidden = !editing;
        this.confirmButton.textContent = this.t(editing ? 'update' : 'insert');
        this.setError(this.url, '');

        return this.open();
    }

    submit() {
        let href = this.url.value.trim();

        // "example.com/page" -> "https://example.com/page"
        if (/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#:].*)?$/i.test(href) && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
            href = `https://${href}`;
        }

        const safe = safeUrl(href, this.editor.policy.protocols, false);

        if (!href || !safe) {
            this.setError(this.url, this.t('invalid_url'));
            this.url.focus();

            return;
        }

        this.close({ href: safe, text: this.text.value, newTab: this.newTab.checked });
    }
}

// ---------------------------------------------------------------------------

export class ImageDialog extends Dialog {
    constructor(editor) {
        super(editor, editor.t('image_title'), { wide: true });

        const images = editor.config.images;
        this.images = images;
        this.file = null;
        this.objectUrl = null;

        const canUpload = images.upload;
        const canUrl = images.allowUrl || !canUpload;
        this.sourceChoice = null;

        if (canUpload && canUrl) {
            const group = el(this.doc, 'div', { className: 'ipx-rte-dialog__tabs', role: 'radiogroup', 'aria-label': this.t('image_title') });
            const name = uniqueId('ipx-rte-source');
            this.uploadRadio = this.input({ type: 'radio', name, value: 'upload', className: 'ipx-rte-dialog__tab-input' });
            this.urlRadio = this.input({ type: 'radio', name, value: 'url', className: 'ipx-rte-dialog__tab-input' });
            group.append(
                this.field(this.t('upload_tab'), this.uploadRadio, { inline: true }),
                this.field(this.t('url_tab'), this.urlRadio, { inline: true }),
            );
            this.uploadRadio.addEventListener('change', () => this.updateSource());
            this.urlRadio.addEventListener('change', () => this.updateSource());
            this.sourceChoice = group;
            this.body.appendChild(group);
        }

        // Upload
        this.uploadSection = el(this.doc, 'div', { className: 'ipx-rte-dialog__section' });

        if (canUpload) {
            if (images.uploadReady) {
                this.fileInput = this.input({ type: 'file', accept: [...images.formats.map((format) => `.${format}`), ...images.mimes].join(',') });
                this.fileInput.addEventListener('change', () => this.chooseFile(this.fileInput.files[0] || null));
                this.uploadSection.append(
                    this.field(this.t('choose_image'), this.fileInput, { help: this.t('allowed_types', { types: images.formats.join(', '), size: formatBytes(images.maxSize) }) }),
                );
            } else {
                this.uploadSection.appendChild(el(this.doc, 'p', { className: 'ipx-rte-dialog__notice', role: 'note', text: this.t('upload_not_configured') }));
            }
        }

        // URL
        this.urlSection = el(this.doc, 'div', { className: 'ipx-rte-dialog__section' });
        this.urlInput = this.input({ type: 'text', inputmode: 'url', autocomplete: 'off', spellcheck: 'false' });

        // Update while typing (not on blur) so the layout never shifts
        // under a click elsewhere in the dialog.
        this.urlInput.addEventListener('input', () => {
            clearTimeout(this.previewTimer);
            this.previewTimer = setTimeout(() => this.updatePreview(), 350);
        });

        if (canUrl) {
            this.urlSection.appendChild(this.field(this.t('image_url'), this.urlInput));
        }

        this.preview = el(this.doc, 'img', { className: 'ipx-rte-dialog__preview', alt: '', hidden: true });

        // Only show previews that actually load.
        this.preview.addEventListener('load', () => {
            this.preview.hidden = !this.preview.getAttribute('src');
        });
        this.preview.addEventListener('error', () => {
            this.preview.hidden = true;
        });
        this.progress = el(this.doc, 'progress', { className: 'ipx-rte-dialog__progress', max: '100', value: '0', hidden: true });

        this.body.append(this.uploadSection, this.urlSection, this.preview, this.progress);

        // Details
        this.alt = this.input({ type: 'text' });
        this.decorative = this.input({ type: 'checkbox', className: 'ipx-rte-dialog__checkbox' });
        this.title = this.input({ type: 'text' });
        this.caption = this.input({ type: 'text' });
        this.decorative.addEventListener('change', () => {
            this.alt.disabled = this.decorative.checked;
        });

        this.richOnly = [];

        if (images.alt) {
            this.body.append(
                this.field(this.t('alt'), this.alt, { help: this.t('alt_help') }),
                this.field(this.t('decorative'), this.decorative, { inline: true }),
            );
        }

        if (images.title) {
            this.body.appendChild(this.field(this.t('title'), this.title));
        }

        if (images.caption) {
            const field = this.field(this.t('caption'), this.caption);
            this.richOnly.push(field);
            this.body.appendChild(field);
        }

        const layout = el(this.doc, 'div', { className: 'ipx-rte-dialog__grid' });
        this.richOnly.push(layout);

        if (images.dimensions) {
            this.widthControls = this.dimensionControls('width');
            layout.appendChild(this.widthControls.wrapper);

            if (images.height) {
                this.heightControls = this.dimensionControls('height');
                layout.appendChild(this.heightControls.wrapper);
            }
        }

        if (images.alignments.length) {
            this.alignment = this.select([['', this.t('align_none')], ...images.alignments.map((value) => [value, this.t(`image_align_${value}`)])], '');
            layout.appendChild(this.field(this.t('alignment'), this.alignment));
        }

        if (images.display) {
            this.display = this.select([['inline', this.t('display_inline')], ['block', this.t('display_block')]], 'inline');
            layout.appendChild(this.field(this.t('display'), this.display));
        }

        if (layout.childNodes.length) {
            this.body.appendChild(layout);
        }

        this.classBoxes = [];
        const classes = Object.entries(images.classes || {});

        if (classes.length) {
            const fieldset = el(this.doc, 'fieldset', { className: 'ipx-rte-dialog__fieldset' });
            fieldset.appendChild(el(this.doc, 'legend', { className: 'ipx-rte-dialog__label', text: this.t('image_styles') }));

            for (const [className, label] of classes) {
                const box = this.input({ type: 'checkbox', className: 'ipx-rte-dialog__checkbox', value: className });
                this.classBoxes.push(box);
                fieldset.appendChild(this.field(label, box, { inline: true }));
            }

            this.richOnly.push(fieldset);
            this.body.appendChild(fieldset);
        }

        if (images.customClasses) {
            this.customClasses = this.input({ type: 'text', autocomplete: 'off', spellcheck: 'false' });
            const field = this.field(this.t('custom_classes'), this.customClasses, { help: this.t('custom_classes_help') });
            this.richOnly.push(field);
            this.body.appendChild(field);
        }
    }

    dimensionControls(kind) {
        const images = this.images;
        const wrapper = el(this.doc, 'div', { className: 'ipx-rte-dialog__field' });
        const label = el(this.doc, 'span', { className: 'ipx-rte-dialog__label', text: this.t(kind), id: uniqueId('ipx-rte-dimension') });
        const row = el(this.doc, 'div', { className: 'ipx-rte-dialog__row', role: 'group', 'aria-labelledby': label.id });
        const steps = images.percentSteps.filter((step) => SUPPORTED_PERCENTS.includes(step));
        const percent = this.select([['', this.t('auto')], ...steps.map((step) => [String(step), `${step}%`])], '');
        const pixels = this.input({ type: 'number', min: '1', max: String(images.maxPixels), step: '1', inputmode: 'numeric' });
        const units = images.units.filter((unit) => unit === 'px' || (unit === '%' && steps.length));
        const unit = this.select(units.map((value) => [value, value]), units[0] || 'px');
        const error = el(this.doc, 'p', { className: 'ipx-rte-dialog__error', id: uniqueId('ipx-rte-dimension-error'), hidden: true });

        percent.setAttribute('aria-label', `${this.t(kind)} (%)`);
        pixels.setAttribute('aria-label', `${this.t(kind)} (px)`);
        unit.setAttribute('aria-label', this.t('unit'));
        pixels.ipxError = error;

        const sync = () => {
            percent.hidden = unit.value !== '%';
            pixels.hidden = unit.value !== 'px';
        };

        unit.addEventListener('change', sync);
        row.append(percent, pixels);

        if (units.length > 1) {
            row.appendChild(unit);
        }

        wrapper.append(label, row, error);
        sync();

        return { wrapper, percent, pixels, unit, sync };
    }

    updateSource() {
        const useUpload = !this.urlRadio || (this.uploadRadio && this.uploadRadio.checked);

        this.uploadSection.hidden = !useUpload;
        this.urlSection.hidden = useUpload && !!this.urlRadio;

        if (!this.images.upload) {
            this.uploadSection.hidden = true;
            this.urlSection.hidden = false;
        }

        this.updatePreview();
    }

    usingUpload() {
        if (!this.images.upload) {
            return false;
        }

        return !this.urlRadio || this.uploadRadio.checked;
    }

    chooseFile(file) {
        this.file = null;
        this.setError(this.fileInput, '');

        if (!file) {
            this.updatePreview();
            return;
        }

        const error = validateFile(file, this.images, this.t);

        if (error) {
            this.setError(this.fileInput, error);
            this.fileInput.value = '';
            this.updatePreview();

            return;
        }

        this.file = file;
        this.updatePreview();
    }

    updatePreview() {
        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = null;
        }

        let source = null;

        if (this.usingUpload() && this.file) {
            this.objectUrl = URL.createObjectURL(this.file);
            source = this.objectUrl;
        } else if (!this.usingUpload()) {
            source = safeUrl(this.urlInput.value.trim(), new Set(['http', 'https']), false);
        }

        if (source) {
            if (this.preview.getAttribute('src') !== source) {
                this.preview.hidden = true;
                this.preview.src = source;
            }
        } else {
            this.preview.hidden = true;
            this.preview.removeAttribute('src');
        }
    }

    /**
     * @param {object} options { values, editing, markdown, file }
     */
    show({ values = {}, editing = false, markdown = false, file = null } = {}) {
        this.markdown = markdown;
        this.editing = editing;
        this.heading.textContent = this.t(editing ? 'image_edit_title' : 'image_title');
        this.confirmButton.textContent = this.t(editing ? 'update' : 'insert');
        this.file = null;
        this.progress.hidden = true;
        this.setBusy(false);

        for (const element of this.richOnly) {
            element.hidden = markdown;
        }

        if (this.fileInput) {
            this.fileInput.value = '';
            this.setError(this.fileInput, '');
        }

        this.urlInput.value = values.src || '';
        this.alt.value = values.alt || '';
        this.decorative.checked = editing && values.alt === '';
        this.alt.disabled = this.decorative.checked;
        this.title.value = values.title || '';
        this.caption.value = values.caption || '';
        this.setError(this.alt, '');
        this.setError(this.urlInput, '');

        const fill = (controls, value) => {
            if (!controls) {
                return;
            }

            controls.percent.value = '';
            controls.pixels.value = '';
            this.setError(controls.pixels, '');

            if (value && value.unit === '%' && controls.unit.querySelector('option[value="%"]')) {
                controls.unit.value = '%';
                controls.percent.value = String(value.value);
            } else if (value && value.unit === 'px') {
                controls.unit.value = 'px';
                controls.pixels.value = String(value.value);
            }

            controls.sync();
        };

        fill(this.widthControls, values.width);
        fill(this.heightControls, values.height);

        if (this.alignment) {
            this.alignment.value = values.alignment || '';
        }

        if (this.display) {
            this.display.value = values.display || 'inline';
        }

        const selected = new Set(values.classes || []);

        for (const box of this.classBoxes) {
            box.checked = selected.has(box.value);
        }

        if (this.customClasses) {
            this.customClasses.value = (values.customClasses || []).join(' ');
            this.setError(this.customClasses, '');
        }

        if (this.urlRadio) {
            const preferUrl = editing || !this.images.uploadReady;
            this.urlRadio.checked = preferUrl;
            this.uploadRadio.checked = !preferUrl;
        }

        this.updateSource();

        const opened = this.open();

        if (file && this.fileInput) {
            if (this.uploadRadio) {
                this.uploadRadio.checked = true;
                this.updateSource();
            }

            this.chooseFile(file);
            this.alt.focus();
        }

        return opened.finally(() => {
            if (this.objectUrl) {
                URL.revokeObjectURL(this.objectUrl);
                this.objectUrl = null;
            }
        });
    }

    readDimension(controls) {
        if (!controls) {
            return { value: null, valid: true };
        }

        if (controls.unit.value === '%') {
            return { value: controls.percent.value ? { unit: '%', value: Number(controls.percent.value) } : null, valid: true };
        }

        const raw = controls.pixels.value.trim();

        if (!raw) {
            this.setError(controls.pixels, '');

            return { value: null, valid: true };
        }

        const number = Number(raw);
        const valid = /^\d+$/.test(raw) && number >= 1 && number <= this.images.maxPixels;

        this.setError(controls.pixels, valid ? '' : this.t('invalid_dimension', { max: this.images.maxPixels }));

        return { value: valid ? { unit: 'px', value: number } : null, valid };
    }

    async submit() {
        if (this.busy) {
            return;
        }

        let valid = true;
        const upload = this.usingUpload();
        let src = null;

        if (upload) {
            if (!this.images.uploadReady) {
                this.showAlert(this.t('upload_not_configured'));
                return;
            }

            if (!this.file && !(this.editing && this.urlInput.value)) {
                this.setError(this.fileInput, this.t('image_required'));
                valid = false;
            }
        } else {
            src = safeUrl(this.urlInput.value.trim(), new Set(['http', 'https']), false);

            if (!src) {
                this.setError(this.urlInput, this.t(this.urlInput.value.trim() ? 'invalid_url' : 'image_required'));
                valid = false;
            } else {
                this.setError(this.urlInput, '');
            }
        }

        const decorative = this.decorative.checked;
        const alt = this.alt.value.trim();

        if (this.images.alt && this.images.requireAlt && !decorative && !alt) {
            this.setError(this.alt, this.t('alt_required'));
            valid = false;
        } else {
            this.setError(this.alt, '');
        }

        const markdown = this.markdown;
        const width = markdown ? { value: null, valid: true } : this.readDimension(this.widthControls);
        const height = markdown ? { value: null, valid: true } : this.readDimension(this.heightControls);
        valid = valid && width.valid && height.valid;

        let customClasses = [];

        if (this.customClasses && !markdown) {
            customClasses = this.customClasses.value.split(/\s+/).filter(Boolean);

            if (customClasses.some((name) => !isCustomClass(name))) {
                this.setError(this.customClasses, this.t('invalid_classes'));
                valid = false;
            } else {
                this.setError(this.customClasses, '');
            }
        }

        if (!valid) {
            const invalid = this.form.querySelector('[aria-invalid="true"]');

            if (invalid) {
                invalid.focus();
            }

            return;
        }

        if (upload && this.file) {
            this.setBusy(true);
            this.progress.hidden = false;
            this.progress.value = 0;
            this.showAlert('');

            try {
                const result = await uploadFile({
                    url: this.editor.config.upload.url,
                    field: this.editor.config.upload.field,
                    file: this.file,
                    type: 'image',
                    csrfToken: this.editor.config.csrfToken,
                    t: this.t,
                    doc: this.doc,
                    onProgress: (percent) => {
                        this.progress.value = percent;
                    },
                });

                src = result.url;
            } catch (error) {
                this.setBusy(false);
                this.progress.hidden = true;
                this.showAlert(error.message);
                this.editor.emit('upload-error', { message: error.message, type: 'image' });

                return;
            }

            this.setBusy(false);
        } else if (upload) {
            src = this.urlInput.value;
        }

        this.close({
            src,
            alt: decorative ? '' : alt,
            title: this.title.value.trim(),
            caption: markdown ? '' : this.caption.value.trim(),
            width: width.value,
            height: height.value,
            alignment: this.alignment && !markdown ? this.alignment.value : '',
            display: this.display && !markdown ? this.display.value : 'inline',
            classes: markdown ? [] : this.classBoxes.filter((box) => box.checked).map((box) => box.value),
            customClasses,
        });
    }
}

// ---------------------------------------------------------------------------

export class FileDialog extends Dialog {
    constructor(editor) {
        super(editor, editor.t('file_title'));

        const files = editor.config.files;
        this.files = files;

        if (files.uploadReady) {
            this.fileInput = this.input({ type: 'file', accept: [...files.formats.map((format) => `.${format}`), ...files.mimes].join(',') });
            this.text = this.input({ type: 'text' });
            this.progress = el(this.doc, 'progress', { className: 'ipx-rte-dialog__progress', max: '100', value: '0', hidden: true });
            this.fileInput.addEventListener('change', () => {
                const file = this.fileInput.files[0];
                this.setError(this.fileInput, file ? validateFile(file, files, this.t) || '' : '');

                if (file && !this.text.value) {
                    this.text.value = file.name;
                }
            });

            this.body.append(
                this.field(this.t('choose_file'), this.fileInput, { help: this.t('allowed_types', { types: files.formats.join(', '), size: formatBytes(files.maxSize) }) }),
                this.field(this.t('file_link_text'), this.text),
                this.progress,
            );
        } else {
            this.body.appendChild(el(this.doc, 'p', { className: 'ipx-rte-dialog__notice', role: 'note', text: this.t('upload_not_configured') }));
            this.confirmButton.disabled = true;
        }
    }

    show({ file = null } = {}) {
        if (this.fileInput) {
            this.fileInput.value = '';
            this.text.value = '';
            this.progress.hidden = true;
            this.setError(this.fileInput, '');
            this.setBusy(false);
        }

        const opened = this.open();

        if (file && this.fileInput) {
            const transfer = typeof DataTransfer === 'function' ? new DataTransfer() : null;

            if (transfer) {
                transfer.items.add(file);
                this.fileInput.files = transfer.files;
                this.fileInput.dispatchEvent(new Event('change'));
            }
        }

        return opened;
    }

    async submit() {
        if (!this.fileInput || this.busy) {
            return;
        }

        const file = this.fileInput.files[0];
        const error = file ? validateFile(file, this.files, this.t) : this.t('file_required');

        if (error) {
            this.setError(this.fileInput, error);
            this.fileInput.focus();

            return;
        }

        this.setBusy(true);
        this.progress.hidden = false;
        this.showAlert('');

        try {
            const result = await uploadFile({
                url: this.editor.config.upload.url,
                field: this.editor.config.upload.field,
                file,
                type: 'file',
                csrfToken: this.editor.config.csrfToken,
                t: this.t,
                doc: this.doc,
                onProgress: (percent) => {
                    this.progress.value = percent;
                },
            });

            this.setBusy(false);
            this.close({ url: result.url, name: result.name, size: result.size, text: this.text.value.trim() || result.name });
        } catch (failure) {
            this.setBusy(false);
            this.progress.hidden = true;
            this.showAlert(failure.message);
            this.editor.emit('upload-error', { message: failure.message, type: 'file' });
        }
    }
}

// ---------------------------------------------------------------------------

export class TableDialog extends Dialog {
    constructor(editor) {
        super(editor, editor.t('table_title'));

        const tables = editor.config.tables;
        this.tables = tables;
        this.rows = this.input({ type: 'number', min: '1', max: String(tables.maxRows), step: '1', value: '3', inputmode: 'numeric' });
        this.columns = this.input({ type: 'number', min: '1', max: String(tables.maxColumns), step: '1', value: '3', inputmode: 'numeric' });
        this.header = this.input({ type: 'checkbox', className: 'ipx-rte-dialog__checkbox' });

        const grid = el(this.doc, 'div', { className: 'ipx-rte-dialog__grid' });
        grid.append(this.field(this.t('rows'), this.rows), this.field(this.t('columns'), this.columns));
        this.body.append(grid, this.field(this.t('header_row'), this.header, { inline: true }));

        this.presetBoxes = presetFieldset(this, tables);
    }

    show() {
        this.header.checked = this.tables.headerRow;
        this.setError(this.rows, '');
        this.setError(this.columns, '');

        for (const box of this.presetBoxes) {
            box.checked = this.tables.defaultPresets.includes(box.value);
        }

        return this.open();
    }

    submit() {
        const read = (input, max) => {
            const value = Number(input.value);
            const valid = /^\d+$/.test(input.value.trim()) && value >= 1 && value <= max;

            this.setError(input, valid ? '' : this.t('invalid_table_size', { max }));

            return valid ? value : null;
        };

        const rows = read(this.rows, this.tables.maxRows);
        const columns = read(this.columns, this.tables.maxColumns);

        if (!rows || !columns) {
            return;
        }

        this.close({
            rows,
            columns,
            header: this.header.checked,
            presets: this.presetBoxes.filter((box) => box.checked).map((box) => box.value),
        });
    }
}

function presetFieldset(dialog, tables) {
    const boxes = [];
    const presets = Object.entries(tables.presets || {});

    if (!presets.length) {
        return boxes;
    }

    const fieldset = el(dialog.doc, 'fieldset', { className: 'ipx-rte-dialog__fieldset' });
    fieldset.appendChild(el(dialog.doc, 'legend', { className: 'ipx-rte-dialog__label', text: dialog.t('table_presets') }));

    for (const [key, label] of presets) {
        const box = dialog.input({ type: 'checkbox', className: 'ipx-rte-dialog__checkbox', value: key });
        boxes.push(box);
        fieldset.appendChild(dialog.field(label, box, { inline: true }));
    }

    dialog.body.appendChild(fieldset);

    return boxes;
}

export class TableDesignDialog extends Dialog {
    constructor(editor) {
        super(editor, editor.t('table_design'));
        this.confirmButton.textContent = this.t('apply');
        this.presetBoxes = presetFieldset(this, editor.config.tables);
    }

    show(current) {
        for (const box of this.presetBoxes) {
            box.checked = current.includes(box.value);
        }

        return this.open();
    }

    submit() {
        this.close(this.presetBoxes.filter((box) => box.checked).map((box) => box.value));
    }
}

// ---------------------------------------------------------------------------

export class ConfirmDialog extends Dialog {
    constructor(editor) {
        super(editor, editor.t('convert_title'));
        this.message = el(this.doc, 'p', { className: 'ipx-rte-dialog__text' });
        this.list = el(this.doc, 'ul', { className: 'ipx-rte-dialog__list' });
        this.hint = el(this.doc, 'p', { className: 'ipx-rte-dialog__help', text: this.t('convert_undo_hint') });
        this.body.append(this.message, this.list, this.hint);
        this.confirmButton.textContent = this.t('convert_continue');
    }

    show(message, items) {
        this.message.textContent = message;
        this.list.textContent = '';

        for (const item of items) {
            this.list.appendChild(el(this.doc, 'li', { text: item }));
        }

        const opened = this.open();
        this.cancelButton.focus();

        return opened;
    }
}
