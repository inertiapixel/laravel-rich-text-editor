<?php

namespace InertiaPixel\RichTextEditor\Support;

final class ClassNames
{
    /**
     * Class tokens accepted from configuration and validated user input.
     * Allows common utility-class syntax (md:w-1/2, w-[300px]) but no
     * whitespace, quotes or angle brackets.
     */
    public const PATTERN = '/^-?[A-Za-z_][A-Za-z0-9_\-:\/.\[\]%]*$/';

    public const RESERVED_PREFIX = 'ipx-rte';

    public static function isValid(string $class): bool
    {
        return strlen($class) <= 100 && preg_match(self::PATTERN, $class) === 1;
    }

    public static function isPresetKey(string $key): bool
    {
        return preg_match('/^[a-z0-9][a-z0-9-]*$/', $key) === 1;
    }
}
