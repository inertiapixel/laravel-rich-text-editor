<?php

namespace InertiaPixel\RichTextEditor\Support;

final class FieldName
{
    /**
     * Convert an HTML field name to Laravel's dot notation:
     * "post[content]" => "post.content", "items[0][body]" => "items.0.body".
     */
    public static function dot(string $name): string
    {
        $dotted = preg_replace(['/\[\]$/', '/\[([^\]]*)\]/'], ['', '.$1'], $name) ?? $name;

        return trim($dotted, '.');
    }

    /**
     * Name of the companion field that submits the stored format:
     * "content" => "content_format", "post[content]" => "post[content_format]".
     */
    public static function format(string $name, string|false|null $setting): ?string
    {
        if ($setting === false) {
            return null;
        }

        if (is_string($setting) && $setting !== '') {
            return $setting;
        }

        // Array-style names such as "blocks[]" cannot carry a matching
        // format field reliably; configure format_field explicitly instead.
        if (str_ends_with($name, '[]')) {
            return null;
        }

        if (str_ends_with($name, ']')) {
            return substr($name, 0, -1).'_format]';
        }

        return $name.'_format';
    }
}
