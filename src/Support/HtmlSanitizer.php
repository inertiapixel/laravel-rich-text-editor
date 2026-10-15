<?php

namespace InertiaPixel\RichTextEditor\Support;

use DOMDocument;
use DOMElement;
use DOMNode;
use DOMText;

/**
 * Conservative allowlist sanitizer for editor HTML (ext-dom only).
 *
 * It keeps the semantic elements the editor produces, renames
 * presentational equivalents (b -> strong, ...), unwraps unknown elements,
 * drops scripts and embedded content with their content, removes every
 * attribute that is not explicitly allowed (all style and on* attributes
 * included) and validates URLs and classes.
 *
 * It is a defense-in-depth measure built for the editor's own output. It
 * has not been independently security-audited; for content from untrusted
 * users, consider adding a dedicated, well-tested sanitizer as well.
 */
final class HtmlSanitizer
{
    private const RENAME = [
        'b' => 'strong', 'i' => 'em', 'strike' => 's', 'del' => 's', 'ins' => 'u',
        'kbd' => 'code', 'samp' => 'code', 'tt' => 'code', 'cite' => 'em', 'var' => 'em', 'dfn' => 'em',
    ];

    /** element => allowed attributes (class is checked separately). */
    private const ALLOWED = [
        'p' => ['class'], 'h1' => ['class'], 'h2' => ['class'], 'h3' => ['class'], 'h4' => ['class'],
        'h5' => ['class'], 'h6' => ['class'], 'blockquote' => [], 'ul' => [], 'ol' => ['start'],
        'li' => ['class'], 'pre' => [], 'code' => ['class'], 'hr' => [], 'br' => [], 'strong' => [],
        'em' => [], 'u' => [], 's' => [], 'a' => ['href', 'title', 'target', 'rel', 'class'],
        'img' => ['src', 'alt', 'title', 'width', 'height', 'class'], 'table' => ['class'],
        'thead' => [], 'tbody' => [], 'tr' => [], 'th' => ['scope', 'class'], 'td' => ['class'],
        'figure' => ['class'], 'figcaption' => [],
    ];

    private const SIZE_STEPS = [5, 10, 15, 20, 25, 30, 33, 35, 40, 45, 50, 55, 60, 65, 66, 70, 75, 80, 85, 90, 95, 100];

    /** @var list<string> */
    private array $protocols;

    /** @var list<string> */
    private array $imageClasses;

    /** @var list<string> */
    private array $presets;

    /** @var list<int> */
    private array $headings;

    private bool $customImageClasses;

    private bool $dataImages;

    private int $maxIndent;

    /**
     * @param  array<string, mixed>|null  $config  Resolved editor configuration (defaults to the global one)
     */
    public function __construct(?array $config = null)
    {
        $config ??= app(ConfigResolver::class)->global();

        $this->protocols = array_values(array_filter(
            array_map(fn ($protocol) => strtolower(rtrim((string) $protocol, ':')), $config['links']['protocols'] ?? ['http', 'https', 'mailto', 'tel']),
            fn ($protocol) => ! in_array($protocol, ['javascript', 'vbscript', 'data', 'file'], true),
        ));
        $this->imageClasses = array_keys($config['images']['classes'] ?? []);
        $this->customImageClasses = (bool) ($config['images']['allow_custom_classes'] ?? false);
        $this->presets = array_keys($config['tables']['presets'] ?? []);
        $this->headings = array_map('intval', $config['headings'] ?? [1, 2, 3, 4, 5, 6]);
        $this->dataImages = (bool) ($config['paste']['allow_data_images'] ?? false);
        $this->maxIndent = (int) ($config['max_indent'] ?? 4);
    }

    /**
     * Sanitize with the application's configuration.
     */
    public static function clean(?string $html): string
    {
        return (new self())->sanitize((string) $html);
    }

    public function sanitize(string $html): string
    {
        if (trim($html) === '') {
            return '';
        }

        $body = Html::body($html);
        $this->cleanChildren($body);

        $output = '';

        foreach ($body->childNodes as $child) {
            $output .= $body->ownerDocument->saveHTML($child);
        }

        return trim($output);
    }

    private function cleanChildren(DOMNode $node): void
    {
        foreach (iterator_to_array($node->childNodes) as $child) {
            $this->cleanNode($child);
        }
    }

    private function cleanNode(DOMNode $node): void
    {
        if ($node instanceof DOMText) {
            return;
        }

        if (! $node instanceof DOMElement) {
            // Comments, processing instructions, CDATA.
            $node->parentNode?->removeChild($node);

            return;
        }

        $tag = strtolower($node->nodeName);

        if (Html::isDropped($tag)) {
            if (Html::isVoid($tag)) {
                // Anything "inside" a void element was misnested by the parser.
                $this->cleanChildren($node);
                $this->unwrap($node);
            } else {
                $node->parentNode?->removeChild($node);
            }

            return;
        }

        if (isset(self::RENAME[$tag])) {
            $node = $this->rename($node, self::RENAME[$tag]);
            $tag = self::RENAME[$tag];
        }

        if (preg_match('/^h([1-6])$/', $tag, $match) && ! in_array((int) $match[1], $this->headings, true)) {
            $node = $this->rename($node, $this->nearestHeading((int) $match[1]));
            $tag = strtolower($node->nodeName);
        }

        if (! isset(self::ALLOWED[$tag])) {
            $this->cleanChildren($node);
            $this->unwrap($node);

            return;
        }

        $this->cleanAttributes($node, $tag);

        if ($tag === 'a' && ! $node->hasAttribute('href')) {
            $this->cleanChildren($node);
            $this->unwrap($node);

            return;
        }

        if ($tag === 'img' && ! $node->hasAttribute('src')) {
            $node->parentNode?->removeChild($node);

            return;
        }

        if ($tag === 'pre') {
            // Code blocks keep their text only.
            $code = $node->getElementsByTagName('code')->item(0);
            $class = $code instanceof DOMElement ? $this->languageClass($code->getAttribute('class')) : null;
            $text = $node->textContent;

            while ($node->firstChild) {
                $node->removeChild($node->firstChild);
            }

            $codeElement = $node->ownerDocument->createElement('code');

            if ($class !== null) {
                $codeElement->setAttribute('class', $class);
            }

            $codeElement->appendChild($node->ownerDocument->createTextNode($text));
            $node->appendChild($codeElement);

            return;
        }

        $this->cleanChildren($node);
    }

    private function cleanAttributes(DOMElement $node, string $tag): void
    {
        $allowed = self::ALLOWED[$tag];

        foreach (iterator_to_array($node->attributes) as $attribute) {
            $name = strtolower($attribute->nodeName);

            if (! in_array($name, $allowed, true)) {
                $node->removeAttribute($attribute->nodeName);
            }
        }

        if ($node->hasAttribute('class')) {
            $classes = $this->allowedClasses($tag, $node->getAttribute('class'));

            if ($classes === '') {
                $node->removeAttribute('class');
            } else {
                $node->setAttribute('class', $classes);
            }
        }

        if ($tag === 'a') {
            $href = $this->safeUrl($node->getAttribute('href'), $this->protocols, false);

            if ($href === null) {
                $node->removeAttribute('href');
            } else {
                $node->setAttribute('href', $href);
            }

            if ($node->getAttribute('target') === '_blank') {
                $node->setAttribute('rel', 'noopener noreferrer');
            } else {
                $node->removeAttribute('target');
                $node->removeAttribute('rel');
            }
        }

        if ($tag === 'img') {
            $src = $this->safeUrl($node->getAttribute('src'), ['http', 'https'], $this->dataImages);

            if ($src === null) {
                $node->removeAttribute('src');
            } else {
                $node->setAttribute('src', $src);
            }

            if (! $node->hasAttribute('alt')) {
                $node->setAttribute('alt', '');
            }

            foreach (['width', 'height'] as $dimension) {
                if ($node->hasAttribute($dimension) && ! preg_match('/^[1-9]\d{0,4}$/', trim($node->getAttribute($dimension)))) {
                    $node->removeAttribute($dimension);
                }
            }
        }

        if ($tag === 'ol' && $node->hasAttribute('start') && ! preg_match('/^\d{1,9}$/', trim($node->getAttribute('start')))) {
            $node->removeAttribute('start');
        }

        if ($tag === 'th' && $node->hasAttribute('scope') && ! in_array($node->getAttribute('scope'), ['col', 'row'], true)) {
            $node->removeAttribute('scope');
        }
    }

    private function allowedClasses(string $tag, string $value): string
    {
        $kept = [];

        foreach (preg_split('/\s+/', trim($value), -1, PREG_SPLIT_NO_EMPTY) ?: [] as $class) {
            if ($this->classAllowed($tag, $class)) {
                $kept[] = $class;
            }
        }

        return implode(' ', array_unique($kept));
    }

    private function classAllowed(string $tag, string $class): bool
    {
        return match ($tag) {
            'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6' => (bool) preg_match('/^ipx-rte-text-(left|center|right|justify)$/', $class)
                || (preg_match('/^ipx-rte-indent-([1-8])$/', $class, $match) === 1 && (int) $match[1] <= $this->maxIndent),
            'li', 'td', 'th' => (bool) preg_match('/^ipx-rte-text-(left|center|right|justify)$/', $class),
            'code' => $this->languageClass($class) !== null,
            'a' => $class === 'ipx-rte-attachment',
            'table' => $class === 'ipx-rte-table'
                || (str_starts_with($class, 'ipx-rte-table--') && in_array(substr($class, strlen('ipx-rte-table--')), $this->presets, true)),
            'img', 'figure' => $this->imageClassAllowed($class),
            default => false,
        };
    }

    private function imageClassAllowed(string $class): bool
    {
        if (preg_match('/^ipx-rte-[wh]-(\d+)$/', $class, $match)) {
            return in_array((int) $match[1], self::SIZE_STEPS, true);
        }

        if (preg_match('/^ipx-rte-img-(left|center|right)$/', $class) || in_array($class, ['ipx-rte-img--block', 'ipx-rte-img--inline', 'ipx-rte-figure'], true)) {
            return true;
        }

        if (in_array($class, $this->imageClasses, true)) {
            return true;
        }

        return $this->customImageClasses && ClassNames::isValid($class) && ! str_starts_with($class, ClassNames::RESERVED_PREFIX);
    }

    private function languageClass(string $value): ?string
    {
        foreach (preg_split('/\s+/', trim($value), -1, PREG_SPLIT_NO_EMPTY) ?: [] as $class) {
            if (preg_match('/^language-[A-Za-z0-9_+#.-]{1,30}$/', $class)) {
                return $class;
            }
        }

        return null;
    }

    /**
     * @param  list<string>  $protocols
     */
    public function safeUrl(string $value, array $protocols, bool $allowData): ?string
    {
        $trimmed = trim($value);

        if ($trimmed === '' || strlen($trimmed) > 2048) {
            return null;
        }

        // Browsers ignore control characters and whitespace in schemes.
        $compact = (string) preg_replace('/[\x00-\x20\x7F]|\xC2[\x80-\x9F]/', '', $trimmed);

        if (! preg_match('/^([a-z][a-z0-9+.\-]*):/i', $compact, $match)) {
            return str_starts_with($compact, '\\') ? null : $trimmed;
        }

        $protocol = strtolower($match[1]);

        if ($protocol === 'data') {
            return $allowData && preg_match('#^data:image/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$#i', $compact) ? $compact : null;
        }

        return in_array($protocol, $protocols, true) ? $trimmed : null;
    }

    private function nearestHeading(int $level): string
    {
        if ($this->headings === []) {
            return 'p';
        }

        $best = $this->headings[0];

        foreach ($this->headings as $candidate) {
            if (abs($candidate - $level) <= abs($best - $level)) {
                $best = $candidate;
            }
        }

        return 'h'.$best;
    }

    private function rename(DOMElement $node, string $tag): DOMElement
    {
        /** @var DOMDocument $document */
        $document = $node->ownerDocument;
        $replacement = $document->createElement($tag);

        foreach (iterator_to_array($node->attributes) as $attribute) {
            $replacement->setAttribute($attribute->nodeName, $attribute->nodeValue ?? '');
        }

        while ($node->firstChild) {
            $replacement->appendChild($node->firstChild);
        }

        $node->parentNode?->replaceChild($replacement, $node);

        return $replacement;
    }

    private function unwrap(DOMElement $node): void
    {
        $parent = $node->parentNode;

        if ($parent === null) {
            return;
        }

        while ($node->firstChild) {
            $parent->insertBefore($node->firstChild, $node);
        }

        $parent->removeChild($node);
    }
}
