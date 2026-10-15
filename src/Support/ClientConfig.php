<?php

namespace InertiaPixel\RichTextEditor\Support;

use Illuminate\Support\Facades\Route;

/**
 * Builds the browser configuration for one editor from resolved options.
 *
 * Every key is mapped explicitly so server-only settings (disk, directory,
 * middleware, gate, asset delivery) can never leak to the page.
 */
final class ClientConfig
{
    public const FORMAT_FOR_MODE = [
        'rich' => 'html',
        'markdown' => 'markdown',
        'text' => 'text',
        'code' => 'html',
    ];

    public const MODE_SECTION = [
        'rich' => 'rich_text',
        'markdown' => 'markdown',
        'text' => 'plain_text',
        'code' => 'code_view',
    ];

    /** Percentages that have matching classes in the content stylesheet. */
    public const SUPPORTED_PERCENT_STEPS = [5, 10, 15, 20, 25, 30, 33, 35, 40, 45, 50, 55, 60, 65, 66, 70, 75, 80, 85, 90, 95, 100];

    /**
     * @param  array<string, mixed>  $options  Resolved options
     * @param  array<string, string>  $strings  Translated UI strings
     * @return array<string, mixed>
     */
    public static function build(array $options, array $strings = [], string $locale = 'en'): array
    {
        $modes = self::modes($options);
        $uploadUrl = self::uploadUrl($options);
        $images = self::images($options, $uploadUrl);
        $files = self::files($options, $uploadUrl);
        $tables = self::tables($options);
        $links = $options['links'];

        $features = [
            'link' => (bool) $links['enabled'],
            'unlink' => (bool) $links['enabled'],
            'image' => $images['enabled'],
            'file' => $files['enabled'],
            'table' => $tables['enabled'],
            'heading' => $options['headings'] !== [],
        ];

        return [
            'modes' => $modes['enabled'],
            'defaultMode' => $modes['default'],
            'markdownPreview' => (bool) $options['markdown']['preview'],
            'placeholder' => $options['placeholder'],
            'minHeight' => $options['min_height'],
            'maxHeight' => $options['max_height'],
            'theme' => $options['theme'],
            'contentClass' => $options['classes']['content'],
            'toolbar' => self::toolbar($options['toolbar'], $features),
            'headings' => self::headings($options['headings']),
            'maxIndent' => $options['max_indent'],
            'shortcuts' => (object) array_filter($options['shortcuts'], fn ($shortcut) => is_string($shortcut) && $shortcut !== ''),
            'links' => [
                'enabled' => (bool) $links['enabled'],
                'allowNewTab' => (bool) $links['allow_new_tab'],
                'protocols' => self::protocols($links['protocols']),
            ],
            'images' => $images,
            'files' => $files,
            'upload' => [
                'url' => $uploadUrl,
                'field' => $options['uploads']['field'],
            ],
            'tables' => $tables,
            'limits' => self::limits($options['limits']),
            'counter' => [
                'show' => $options['counter']['show'],
                'words' => (bool) $options['counter']['words'],
            ],
            'paste' => [
                'mode' => $options['paste']['mode'],
                'allowDataImages' => (bool) $options['paste']['allow_data_images'],
            ],
            'announceLimits' => (bool) $options['accessibility']['announce_limits'],
            'locale' => $locale,
            'strings' => $strings,
        ];
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array{enabled: list<string>, default: string}
     */
    public static function modes(array $options): array
    {
        $order = array_values(array_unique(array_merge($options['mode_order'], OptionSchema::MODES)));
        $enabled = array_values(array_filter($order, fn (string $mode) => (bool) $options[self::MODE_SECTION[$mode]]['enabled']));

        if ($enabled === []) {
            throw new InvalidOptionException('At least one InertiaPixel Rich Text Editor mode must be enabled.');
        }

        $default = in_array($options['default_mode'], $enabled, true) ? $options['default_mode'] : $enabled[0];

        return ['enabled' => $enabled, 'default' => $default];
    }

    /**
     * @param  array<string, mixed>  $options
     */
    public static function uploadUrl(array $options): ?string
    {
        $url = $options['uploads']['url'];

        if (is_string($url) && trim($url) !== '') {
            $url = trim($url);

            if (! preg_match('#^(https?://|/)#i', $url)) {
                throw new InvalidOptionException('The upload URL must be an absolute http(s) URL or start with "/".');
            }

            return $url;
        }

        $route = $options['uploads']['route'];

        if ($route['enabled'] && Route::has($route['name'])) {
            return route($route['name'], [], false);
        }

        return null;
    }

    /**
     * @param  list<string>  $items
     * @param  array<string, bool>  $features
     * @return list<string>
     */
    private static function toolbar(array $items, array $features): array
    {
        $toolbar = [];

        foreach ($items as $item) {
            if (($features[$item] ?? true) === false) {
                continue;
            }

            if ($item === '|' && ($toolbar === [] || end($toolbar) === '|')) {
                continue;
            }

            if ($item !== '|' && in_array($item, $toolbar, true)) {
                continue;
            }

            $toolbar[] = $item;
        }

        if (end($toolbar) === '|') {
            array_pop($toolbar);
        }

        return $toolbar;
    }

    /**
     * @param  list<int>  $levels
     * @return list<int>
     */
    private static function headings(array $levels): array
    {
        $levels = array_values(array_unique($levels));
        sort($levels);

        return $levels;
    }

    /**
     * @param  list<string>  $protocols
     * @return list<string>
     */
    private static function protocols(array $protocols): array
    {
        $normalized = [];

        foreach ($protocols as $protocol) {
            $protocol = strtolower(rtrim(trim($protocol), ':'));

            if (in_array($protocol, ['javascript', 'vbscript', 'data', 'file'], true)) {
                throw new InvalidOptionException("The link protocol [{$protocol}] is never allowed.");
            }

            if (preg_match('/^[a-z][a-z0-9+.-]*$/', $protocol)) {
                $normalized[] = $protocol;
            }
        }

        return array_values(array_unique($normalized));
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private static function images(array $options, ?string $uploadUrl): array
    {
        $images = $options['images'];
        $classes = [];

        foreach ($images['classes'] as $class => $label) {
            if (! ClassNames::isValid($class)) {
                throw new InvalidOptionException("Invalid image class [{$class}] in [images.classes].");
            }

            $classes[$class] = $label;
        }

        $steps = array_values(array_unique($images['percent_steps']));
        sort($steps);

        foreach ($steps as $step) {
            if (! in_array($step, self::SUPPORTED_PERCENT_STEPS, true)) {
                throw new InvalidOptionException("Unsupported percentage [{$step}] in [images.percent_steps]. Use multiples of 5, 33 or 66.");
            }
        }

        $upload = (bool) $images['enabled'] && (bool) $images['upload'];

        return [
            'enabled' => (bool) $images['enabled'],
            // "upload" is true when uploads are wanted; "uploadReady" tells
            // the dialog whether an endpoint exists, so it can explain a
            // missing configuration instead of failing silently.
            'upload' => $upload,
            'uploadReady' => $upload && $uploadUrl !== null,
            'allowUrl' => (bool) $images['allow_url'],
            'formats' => UploadPolicy::extensions($images['allowed_formats'], 'images.allowed_formats'),
            'mimes' => UploadPolicy::mimes($images['allowed_mimes'], 'images.allowed_mimes'),
            'maxSize' => UploadPolicy::bytes($images['max_size']),
            'alt' => (bool) $images['allow_alt'],
            'requireAlt' => (bool) $images['allow_alt'] && (bool) $images['require_alt'],
            'title' => (bool) $images['allow_title'],
            'caption' => (bool) $images['allow_caption'],
            'classes' => (bool) $images['allow_classes'] ? (object) $classes : (object) [],
            'customClasses' => (bool) $images['allow_classes'] && (bool) $images['allow_custom_classes'],
            'dimensions' => (bool) $images['allow_dimensions'],
            'height' => (bool) $images['allow_dimensions'] && (bool) $images['allow_height'],
            'units' => $images['dimension_units'] === [] ? ['px'] : array_values(array_unique($images['dimension_units'])),
            'percentSteps' => $steps,
            'maxPixels' => $images['max_pixels'],
            'alignments' => (bool) $images['allow_alignment'] ? array_values(array_unique($images['alignments'])) : [],
            'display' => (bool) $images['allow_display'],
            'pasteUpload' => $upload && (bool) $images['allow_paste_upload'],
        ];
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private static function files(array $options, ?string $uploadUrl): array
    {
        $files = $options['files'];

        return [
            'enabled' => (bool) $files['enabled'],
            'uploadReady' => (bool) $files['enabled'] && $uploadUrl !== null,
            'formats' => UploadPolicy::extensions($files['allowed_formats'], 'files.allowed_formats'),
            'mimes' => UploadPolicy::mimes($files['allowed_mimes'], 'files.allowed_mimes'),
            'maxSize' => UploadPolicy::bytes($files['max_size']),
        ];
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private static function tables(array $options): array
    {
        $tables = $options['tables'];

        foreach (array_keys($tables['presets']) as $key) {
            if (! ClassNames::isPresetKey($key)) {
                throw new InvalidOptionException("Invalid table preset key [{$key}]. Use lowercase letters, numbers and hyphens.");
            }
        }

        $defaults = array_values(array_filter(
            array_unique($tables['default_presets']),
            fn (string $key) => array_key_exists($key, $tables['presets']),
        ));

        return [
            'enabled' => (bool) $tables['enabled'],
            'presets' => (object) $tables['presets'],
            'defaultPresets' => $defaults,
            'maxRows' => $tables['max_rows'],
            'maxColumns' => $tables['max_columns'],
            'headerRow' => (bool) $tables['header_row'],
        ];
    }

    /**
     * @param  array<string, mixed>  $limits
     * @return array<string, mixed>
     */
    private static function limits(array $limits): array
    {
        $min = $limits['min_chars'];
        $max = $limits['max_chars'];

        if ($min !== null && $max !== null && $min > $max) {
            throw new InvalidOptionException("The minimum character limit ({$min}) is greater than the maximum ({$max}).");
        }

        return [
            'min' => $min,
            'max' => $max,
            'enforceMax' => (bool) $limits['enforce_max'],
            'validateOnSubmit' => (bool) $limits['validate_on_submit'],
        ];
    }
}
