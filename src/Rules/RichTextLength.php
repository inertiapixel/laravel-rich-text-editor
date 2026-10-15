<?php

namespace InertiaPixel\RichTextEditor\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use InertiaPixel\RichTextEditor\Support\VisibleText;

/**
 * Validates length the way the editor counts it.
 *
 * - "html": visible text only (tags and attributes are not counted).
 * - "markdown" / "text": the source, with CRLF normalized to LF
 *   (browsers submit textarea line breaks as CRLF).
 *
 * The unit is Unicode code points, like PHP's mb_strlen and Laravel's
 * string min/max rules. This rule is optional and never registered
 * globally; use it explicitly:
 *
 *     'content' => ['required', 'string', RichTextLength::between(100, 5000)->format($format)],
 */
final class RichTextLength implements ValidationRule
{
    public const FORMATS = ['html', 'markdown', 'text'];

    private string $format = 'html';

    public function __construct(
        private readonly ?int $min = null,
        private readonly ?int $max = null,
    ) {
    }

    public static function min(int $min): self
    {
        return new self($min, null);
    }

    public static function max(int $max): self
    {
        return new self(null, $max);
    }

    public static function between(int $min, int $max): self
    {
        return new self($min, $max);
    }

    /**
     * Set the stored format. Unknown formats are measured as HTML.
     */
    public function format(?string $format): self
    {
        $this->format = in_array($format, self::FORMATS, true) ? $format : 'html';

        return $this;
    }

    public static function measure(string $value, string $format = 'html'): int
    {
        if ($format === 'markdown' || $format === 'text') {
            return mb_strlen(str_replace(["\r\n", "\r"], "\n", $value), 'UTF-8');
        }

        return VisibleText::length($value);
    }

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value)) {
            $fail('inertiapixel-rich-text-editor::validation.string')->translate();

            return;
        }

        $length = self::measure($value, $this->format);

        if ($this->min !== null && $length < $this->min) {
            $fail('inertiapixel-rich-text-editor::validation.min')->translate(['min' => (string) $this->min]);
        }

        if ($this->max !== null && $length > $this->max) {
            $fail('inertiapixel-rich-text-editor::validation.max')->translate(['max' => (string) $this->max]);
        }
    }
}
