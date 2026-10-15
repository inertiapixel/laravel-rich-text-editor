/**
 * Client-side upload checks and the upload request.
 *
 * These checks only improve the user experience. The upload endpoint must
 * validate extension, real MIME type, size and permissions itself.
 *
 * Request:  POST multipart/form-data with the file in `field` (default
 *           "file") and `type` = "image" | "file".
 * Response: 2xx JSON { "url": "...", "name"?: "...", "size"?: 123,
 *           "mime"?: "...", "type"?: "image" | "file" }.
 * Errors:   non-2xx JSON { "message": "...", "errors"?: { field: [...] } }.
 */

import { safeUrl } from './serializer.js';

export function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) {
        return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
    }

    if (bytes >= 1024) {
        return `${Math.round(bytes / 1024)} KB`;
    }

    return `${bytes} B`;
}

export function fileExtension(name) {
    const match = /\.([A-Za-z0-9]+)$/.exec(name || '');

    return match ? match[1].toLowerCase() : '';
}

/**
 * @returns {string|null} translated error, or null when the file is acceptable
 */
export function validateFile(file, rules, t) {
    const extension = fileExtension(file.name);

    if (!rules.formats || !rules.formats.includes(extension)) {
        return t('file_type_not_allowed');
    }

    // Browsers report an empty type for unknown files; the server decides.
    if (file.type && rules.mimes && rules.mimes.length && !rules.mimes.includes(file.type.toLowerCase())) {
        return t('file_type_not_allowed');
    }

    if (rules.maxSize && file.size > rules.maxSize) {
        return t('file_too_large', { size: formatBytes(rules.maxSize) });
    }

    return null;
}

function csrfHeaders(doc, token) {
    const headers = {};
    const meta = doc.querySelector('meta[name="csrf-token"]');
    const csrf = token || (meta && meta.getAttribute('content'));

    if (csrf) {
        headers['X-CSRF-TOKEN'] = csrf;
    } else {
        const cookie = doc.cookie.split('; ').find((entry) => entry.startsWith('XSRF-TOKEN='));

        if (cookie) {
            headers['X-XSRF-TOKEN'] = decodeURIComponent(cookie.slice('XSRF-TOKEN='.length));
        }
    }

    return headers;
}

/**
 * Validate the server response against the documented contract.
 */
export function parseUploadResponse(body, file) {
    let data = body;

    if (typeof body === 'string') {
        try {
            data = JSON.parse(body);
        } catch (error) {
            return null;
        }
    }

    if (!data || typeof data !== 'object' || typeof data.url !== 'string') {
        return null;
    }

    const url = safeUrl(data.url, new Set(['http', 'https']), false);

    if (!url) {
        return null;
    }

    return {
        url,
        name: typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 200) : file.name,
        size: Number.isFinite(data.size) ? data.size : file.size,
        mime: typeof data.mime === 'string' ? data.mime : file.type,
        type: data.type === 'file' ? 'file' : 'image',
    };
}

function errorMessage(xhr, field, t) {
    try {
        const data = JSON.parse(xhr.responseText);
        const fieldErrors = data && data.errors && data.errors[field];

        if (Array.isArray(fieldErrors) && typeof fieldErrors[0] === 'string') {
            return fieldErrors[0];
        }

        if (data && typeof data.message === 'string' && data.message) {
            return data.message;
        }
    } catch (error) {
        // Not JSON; use the generic message.
    }

    return t('upload_failed');
}

/**
 * Upload with progress. Resolves with the parsed response.
 */
export function uploadFile({ url, field, file, type, csrfToken, onProgress, t, doc = document }) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const data = new FormData();

        data.append(field, file, file.name);
        data.append('type', type);

        xhr.open('POST', url, true);
        xhr.withCredentials = false;
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

        for (const [name, value] of Object.entries(csrfHeaders(doc, csrfToken))) {
            xhr.setRequestHeader(name, value);
        }

        xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable && onProgress) {
                onProgress(Math.round((event.loaded / event.total) * 100));
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                const result = parseUploadResponse(xhr.responseText, file);

                if (result) {
                    resolve(result);
                } else {
                    reject(new Error(t('invalid_upload_response')));
                }

                return;
            }

            reject(new Error(errorMessage(xhr, field, t)));
        });

        xhr.addEventListener('error', () => reject(new Error(t('upload_failed'))));
        xhr.addEventListener('abort', () => reject(new Error(t('upload_failed'))));

        xhr.send(data);
    });
}
