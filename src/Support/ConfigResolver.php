<?php

namespace InertiaPixel\RichTextEditor\Support;

use Illuminate\Contracts\Config\Repository;
use Illuminate\Support\Str;

/**
 * Resolves the effective configuration for one editor instance.
 *
 * Precedence: built-in defaults < config/richtext.php < Blade :options
 * < dedicated Blade attributes. Nothing here writes to the global config.
 */
final class ConfigResolver
{
    /** @var array<string, mixed>|null */
    private static ?array $defaults = null;

    public function __construct(private readonly Repository $config)
    {
    }

    /**
     * The built-in defaults shipped with the package.
     *
     * @return array<string, mixed>
     */
    public static function defaults(): array
    {
        return self::$defaults ??= require dirname(__DIR__, 2).'/config/richtext.php';
    }

    /**
     * Defaults merged with the application's configuration.
     *
     * @return array<string, mixed>
     */
    public function global(): array
    {
        $app = $this->config->get('richtext', []);

        return self::merge(OptionSchema::definition(), self::defaults(), is_array($app) ? $app : [], 'config');
    }

    /**
     * @param  array<string, mixed>  $options  Blade :options
     * @param  array<string, mixed>  $attributes  Options derived from dedicated Blade attributes
     * @return array<string, mixed>
     */
    public function resolve(array $options = [], array $attributes = []): array
    {
        $resolved = $this->global();
        $strict = ($resolved['unknown_options'] ?? 'throw') === 'throw';

        $resolved = self::merge(OptionSchema::definition(), $resolved, $options, 'options', $strict);

        return self::merge(OptionSchema::definition(), $resolved, $attributes, 'options', true);
    }

    /**
     * Merge $override into $base following the schema.
     *
     * @param  array<string, mixed>  $schema
     * @param  array<string, mixed>  $base
     * @param  array<array-key, mixed>  $override
     * @param  'config'|'options'  $source
     * @return array<string, mixed>
     */
    public static function merge(array $schema, array $base, array $override, string $source, bool $strict = true, string $prefix = ''): array
    {
        $sectionConfigOnly = ($schema['@config_only'] ?? false) === true;

        foreach ($override as $key => $value) {
            $key = (string) $key;
            $name = self::resolveKey($schema, $key);
            $path = $prefix.($name ?? $key);

            if ($name === null) {
                // Unknown keys in the config file are ignored so stale keys
                // from older versions never break an application.
                if ($source === 'options' && $strict) {
                    throw InvalidOptionException::unknown($path);
                }

                continue;
            }

            $spec = $schema[$name];

            if ($source === 'options' && ($sectionConfigOnly || self::isConfigOnly($spec))) {
                throw InvalidOptionException::configOnly($path);
            }

            if (is_array($spec)) {
                if (is_bool($value) && isset($spec['@shorthand'])) {
                    $value = [$spec['@shorthand'] => $value];
                }

                if (! is_array($value) || ($value !== [] && array_is_list($value))) {
                    throw InvalidOptionException::invalid($path, 'an associative array', $value);
                }

                $base[$name] = self::merge($spec, is_array($base[$name] ?? null) ? $base[$name] : [], $value, $source, $strict, $path.'.');

                continue;
            }

            $base[$name] = self::cast(self::leafType($spec), $value, $path);
        }

        return $base;
    }

    /**
     * @param  array<string, mixed>  $schema
     */
    private static function resolveKey(array $schema, string $key): ?string
    {
        if ($key === '' || $key[0] === '@') {
            return null;
        }

        if (array_key_exists($key, $schema)) {
            return $key;
        }

        $snake = Str::snake($key);

        return array_key_exists($snake, $schema) ? $snake : null;
    }

    private static function isConfigOnly(mixed $spec): bool
    {
        if (is_array($spec)) {
            return ($spec['@config_only'] ?? false) === true;
        }

        return str_starts_with($spec, '@config_only:');
    }

    private static function leafType(string $spec): string
    {
        return str_starts_with($spec, '@config_only:') ? substr($spec, strlen('@config_only:')) : $spec;
    }

    private static function cast(string $type, mixed $value, string $path): mixed
    {
        if ($type[0] === '?') {
            if ($value === null) {
                return null;
            }

            $type = substr($type, 1);
        }

        [$kind, $argument] = array_pad(explode(':', $type, 2), 2, null);

        return match ($kind) {
            'bool' => is_bool($value) ? $value : throw InvalidOptionException::invalid($path, 'a boolean', $value),
            'string' => is_string($value) ? $value : throw InvalidOptionException::invalid($path, 'a string', $value),
            'int' => self::castInt($value, $argument, $path),
            'number' => self::castNumber($value, $argument, $path),
            'enum' => self::castEnum($value, explode(',', (string) $argument), $path),
            'list' => self::castList($value, (string) $argument, $path),
            'map' => self::castMap($value, $path),
            'css_length' => self::castCssLength($value, $path),
            'class_list' => self::castClassList($value, $path),
            'format_field' => self::castFormatField($value, $path),
            default => throw new \LogicException("Unsupported option type [{$type}]."),
        };
    }

    private static function castInt(mixed $value, ?string $range, string $path): int
    {
        if (is_string($value) && preg_match('/^-?\d+$/', $value)) {
            $value = (int) $value;
        }

        if (! is_int($value)) {
            throw InvalidOptionException::invalid($path, 'an integer', $value);
        }

        if ($range !== null && $range !== '') {
            [$min, $max] = array_pad(explode('-', $range, 2), 2, null);

            if ($value < (int) $min || ($max !== null && $value > (int) $max)) {
                throw InvalidOptionException::invalid($path, $max === null ? "an integer >= {$min}" : "an integer between {$min} and {$max}", $value);
            }
        }

        return $value;
    }

    private static function castNumber(mixed $value, ?string $min, string $path): int|float
    {
        if (is_string($value) && is_numeric($value)) {
            $value += 0;
        }

        if (! is_int($value) && ! is_float($value)) {
            throw InvalidOptionException::invalid($path, 'a number', $value);
        }

        if ($min !== null && $min !== '' && $value < (float) $min) {
            throw InvalidOptionException::invalid($path, "a number >= {$min}", $value);
        }

        return $value;
    }

    /**
     * @param  list<string>  $allowed
     */
    private static function castEnum(mixed $value, array $allowed, string $path): string
    {
        if (! is_string($value) || ! in_array($value, $allowed, true)) {
            throw InvalidOptionException::invalid($path, 'one of ['.implode(', ', $allowed).']', $value);
        }

        return $value;
    }

    /**
     * @return list<mixed>
     */
    private static function castList(mixed $value, string $itemType, string $path): array
    {
        if (! is_array($value) || ! array_is_list($value)) {
            throw InvalidOptionException::invalid($path, 'a list', $value);
        }

        $items = [];

        foreach ($value as $index => $item) {
            $items[] = self::cast($itemType, $item, "{$path}.{$index}");
        }

        return $items;
    }

    /**
     * @return array<string, string>
     */
    private static function castMap(mixed $value, string $path): array
    {
        if (! is_array($value)) {
            throw InvalidOptionException::invalid($path, 'an array of string => string', $value);
        }

        foreach ($value as $key => $label) {
            if (! is_string($key) || ! is_string($label)) {
                throw InvalidOptionException::invalid($path, 'an array of string => string', $value);
            }
        }

        return $value;
    }

    private static function castCssLength(mixed $value, string $path): string
    {
        if (is_int($value) && $value >= 0) {
            return $value.'px';
        }

        if (is_string($value)) {
            $value = trim($value);

            if (preg_match('/^\d+(\.\d+)?$/', $value)) {
                return $value.'px';
            }

            if (preg_match('/^\d+(\.\d+)?(px|em|rem|vh|vw|ch|%)$/', $value)) {
                return $value;
            }
        }

        throw InvalidOptionException::invalid($path, 'a CSS length such as "240px" or "20rem"', $value);
    }

    private static function castClassList(mixed $value, string $path): string
    {
        if ($value === null) {
            return '';
        }

        if (! is_string($value)) {
            throw InvalidOptionException::invalid($path, 'a space-separated class string', $value);
        }

        $classes = preg_split('/\s+/', trim($value), -1, PREG_SPLIT_NO_EMPTY) ?: [];

        foreach ($classes as $class) {
            if (! ClassNames::isValid($class)) {
                throw InvalidOptionException::invalid($path, 'valid CSS class names', $value);
            }
        }

        return implode(' ', $classes);
    }

    private static function castFormatField(mixed $value, string $path): string|false|null
    {
        if ($value === null || $value === false) {
            return $value;
        }

        if (is_string($value) && preg_match('/^[A-Za-z0-9_\-.\[\]]+$/', $value)) {
            return $value;
        }

        throw InvalidOptionException::invalid($path, 'null, false or a field name', $value);
    }
}
