/**
 * Snapshot-based undo/redo for one editor instance.
 *
 * The editor supplies capture() and restore(snapshot). Consecutive typing
 * within `mergeDelay` is merged into one step.
 */

export class History {
    constructor({ capture, restore, onChange, limit = 100, mergeDelay = 1000 }) {
        this.capture = capture;
        this.restore = restore;
        this.onChange = onChange || (() => {});
        this.limit = limit;
        this.mergeDelay = mergeDelay;
        this.stack = [];
        this.index = -1;
        this.lastKind = null;
        this.lastTime = 0;
    }

    reset() {
        this.stack = [this.capture()];
        this.index = 0;
        this.lastKind = null;
        this.onChange();
    }

    /**
     * Record the current state after a change.
     *
     * @param {string} kind "typing" merges with the previous typing step.
     */
    record(kind = 'change') {
        const snapshot = this.capture();
        const now = Date.now();
        const top = this.stack[this.index];

        if (top && top.key === snapshot.key) {
            // Nothing changed; keep the newer selection.
            this.stack[this.index] = snapshot;
            return;
        }

        this.stack.length = this.index + 1;

        const merge = kind === 'typing' && this.lastKind === 'typing' && now - this.lastTime < this.mergeDelay && this.index > 0 && top && top.mode === snapshot.mode;

        if (merge) {
            this.stack[this.index] = snapshot;
        } else {
            this.stack.push(snapshot);
            this.index += 1;

            if (this.stack.length > this.limit) {
                this.stack.shift();
                this.index -= 1;
            }
        }

        this.lastKind = kind;
        this.lastTime = now;
        this.onChange();
    }

    /** Stop merging so the next typing starts a new step. */
    seal() {
        this.lastKind = null;
    }

    canUndo() {
        return this.index > 0;
    }

    canRedo() {
        return this.index < this.stack.length - 1;
    }

    undo() {
        if (!this.canUndo()) {
            return false;
        }

        this.index -= 1;
        this.lastKind = null;
        this.restore(this.stack[this.index]);
        this.onChange();

        return true;
    }

    redo() {
        if (!this.canRedo()) {
            return false;
        }

        this.index += 1;
        this.lastKind = null;
        this.restore(this.stack[this.index]);
        this.onChange();

        return true;
    }
}

/** Path of child indexes from root to node. */
export function nodePath(root, node) {
    const path = [];
    let current = node;

    while (current && current !== root) {
        const parent = current.parentNode;

        if (!parent) {
            return null;
        }

        path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
        current = parent;
    }

    return current === root ? path : null;
}

export function resolvePath(root, path) {
    let current = root;

    for (const index of path || []) {
        if (!current.childNodes[index]) {
            return null;
        }

        current = current.childNodes[index];
    }

    return current;
}
