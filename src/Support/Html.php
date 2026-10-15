<?php

namespace InertiaPixel\RichTextEditor\Support;

use DOMDocument;
use DOMElement;

/**
 * Shared HTML parsing helpers (ext-dom, no third-party packages).
 */
final class Html
{
    public const BLOCK_TAGS = [
        'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'pre',
        'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'figure', 'figcaption',
        'div', 'section', 'article', 'header', 'footer', 'aside', 'nav', 'main', 'address',
        'dl', 'dt', 'dd', 'caption', 'center', 'details', 'summary', 'form', 'fieldset',
    ];

    /** Removed together with their content. */
    public const DROP_WITH_CONTENT = [
        'script', 'style', 'template', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed',
        'applet', 'svg', 'math', 'title', 'meta', 'link', 'base', 'head', 'canvas', 'video', 'audio',
        'source', 'track', 'input', 'button', 'select', 'option', 'optgroup', 'textarea', 'map', 'area',
        'dialog', 'param', 'xml', 'colgroup', 'col', 'picture', 'portal', 'slot', 'menu', 'datalist',
        'output', 'progress', 'meter',
    ];

    /**
     * Elements that are void in HTML5. Older libxml2 versions (2.9.x)
     * do not know some of them (embed, source, track, wbr) and nest the
     * following content inside them, so they must never "own" content.
     */
    public const VOID_TAGS = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];

    /**
     * Parse an HTML fragment into a document and return its <body>.
     */
    public static function body(string $html): DOMElement
    {
        $document = new DOMDocument('1.0', 'UTF-8');
        $previous = libxml_use_internal_errors(true);

        // The meta element makes libxml treat the input as UTF-8.
        $document->loadHTML(
            '<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body>'.$html.'</body></html>',
            LIBXML_NONET | LIBXML_COMPACT,
        );

        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        $body = $document->getElementsByTagName('body')->item(0);

        if (! $body instanceof DOMElement) {
            $body = $document->createElement('body');
            $document->appendChild($body);
        }

        return $body;
    }

    public static function isBlock(string $tag): bool
    {
        return in_array($tag, self::BLOCK_TAGS, true);
    }

    public static function isDropped(string $tag): bool
    {
        return in_array($tag, self::DROP_WITH_CONTENT, true);
    }

    public static function isVoid(string $tag): bool
    {
        return in_array($tag, self::VOID_TAGS, true);
    }
}
