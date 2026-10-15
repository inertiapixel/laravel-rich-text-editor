/**
 * Character counter.
 *
 * Shown automatically when a minimum or maximum is configured, unless
 * counter.show forces it on or off. The visible counter is not a live
 * region; crossing a limit is announced through a separate polite live
 * region, at most once per state change.
 */

import { el, uniqueId } from './dom.js';

export function limitState(count, limits) {
    const { min, max } = limits;

    if (max !== null && max !== undefined && count > max) {
        return 'over';
    }

    if (max !== null && max !== undefined && count === max) {
        return 'at-max';
    }

    if (min !== null && min !== undefined && count < min) {
        return 'under';
    }

    return 'ok';
}

export class Counter {
    constructor(editor) {
        this.editor = editor;
        this.t = editor.t;

        const { limits, counter } = editor.config;
        const hasLimit = (limits.min !== null && limits.min !== undefined) || (limits.max !== null && limits.max !== undefined);

        this.limits = limits;
        this.words = !!counter.words;
        this.visible = counter.show === null || counter.show === undefined ? hasLimit : !!counter.show;
        this.state = null;
        this.timer = null;

        this.element = el(editor.doc, 'div', { className: 'ipx-rte__counter', id: uniqueId('ipx-rte-counter'), hidden: !this.visible });
        this.live = el(editor.doc, 'div', { className: 'ipx-rte__sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
    }

    text(count, words) {
        const { min, max } = this.limits;
        const hasMin = min !== null && min !== undefined;
        const hasMax = max !== null && max !== undefined;
        let label;

        if (hasMin && hasMax) {
            label = this.t('character_range', { count, max, min });
        } else if (hasMax) {
            label = this.t('character_max', { count, max });
        } else if (hasMin) {
            label = this.t('character_min', { count, min });
        } else {
            label = this.t('character_count', { count });
        }

        if (this.words) {
            label += ` · ${this.t('word_count', { count: words })}`;
        }

        return label;
    }

    update(count, words, { announce = true } = {}) {
        const state = limitState(count, this.limits);

        this.element.textContent = this.text(count, words);
        this.element.classList.toggle('ipx-rte__counter--under', state === 'under');
        this.element.classList.toggle('ipx-rte__counter--at-max', state === 'at-max');
        this.element.classList.toggle('ipx-rte__counter--over', state === 'over');
        this.element.setAttribute('data-state', state);

        if (this.state !== null && state !== this.state && announce && this.editor.config.announceLimits) {
            this.scheduleAnnouncement(state, count);
        }

        this.state = state;

        return state;
    }

    message(state, count) {
        const { min, max } = this.limits;

        if (state === 'over') {
            return this.t('max_exceeded', { max, over: count - max });
        }

        if (state === 'at-max') {
            return this.t('max_reached', { max });
        }

        if (state === 'under') {
            return this.t('min_not_met', { min, remaining: min - count });
        }

        return this.t('limit_ok');
    }

    scheduleAnnouncement(state, count) {
        clearTimeout(this.timer);

        this.timer = setTimeout(() => {
            this.announce(this.message(state, count));
        }, 700);
    }

    announce(message) {
        this.live.textContent = '';

        // A separate tick makes screen readers announce repeated messages.
        setTimeout(() => {
            this.live.textContent = message;
        }, 30);
    }

    destroy() {
        clearTimeout(this.timer);
    }
}
