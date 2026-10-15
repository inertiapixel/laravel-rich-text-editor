<?php

namespace InertiaPixel\RichTextEditor\Support;

use InvalidArgumentException;

final class InvalidOptionException extends InvalidArgumentException
{
    public static function unknown(string $path): self
    {
        return new self("Unknown InertiaPixel Rich Text Editor option [{$path}].");
    }

    public static function configOnly(string $path): self
    {
        return new self("The InertiaPixel Rich Text Editor option [{$path}] can only be set in config/richtext.php, not per instance.");
    }

    public static function invalid(string $path, string $expected, mixed $value): self
    {
        $given = get_debug_type($value);

        return new self("Invalid value for InertiaPixel Rich Text Editor option [{$path}]: expected {$expected}, {$given} given.");
    }
}
