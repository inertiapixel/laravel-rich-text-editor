<?php

namespace InertiaPixel\RichTextEditor\Tests\Feature;

use InertiaPixel\RichTextEditor\Support\ConfigResolver;
use InertiaPixel\RichTextEditor\Support\InvalidOptionException;
use InertiaPixel\RichTextEditor\Tests\TestCase;

class ConfigurationTest extends TestCase
{
    private function resolver(): ConfigResolver
    {
        return app(ConfigResolver::class);
    }

    public function test_built_in_defaults_work_without_publishing(): void
    {
        $this->assertFileDoesNotExist(config_path('richtext.php'));

        $resolved = $this->resolver()->resolve();

        $this->assertSame('rich', $resolved['default_mode']);
        $this->assertTrue($resolved['images']['enabled']);
        $this->assertSame(['jpg', 'jpeg', 'png', 'gif', 'webp'], $resolved['images']['allowed_formats']);
        $this->assertFalse($resolved['uploads']['route']['enabled']);
        $this->assertSame('rich', config('richtext.default_mode'));
    }

    public function test_laravel_config_overrides_defaults_recursively(): void
    {
        // A published file containing only part of a section.
        config(['richtext' => ['images' => ['max_size' => 2], 'tables' => ['enabled' => false]]]);

        $resolved = $this->resolver()->resolve();

        $this->assertSame(2, $resolved['images']['max_size']);
        $this->assertTrue($resolved['images']['allow_alt']);
        $this->assertSame(['jpg', 'jpeg', 'png', 'gif', 'webp'], $resolved['images']['allowed_formats']);
        $this->assertFalse($resolved['tables']['enabled']);
        $this->assertSame(['bordered' => 'Bordered', 'striped' => 'Striped', 'compact' => 'Compact', 'responsive' => 'Responsive'], $resolved['tables']['presets']);
    }

    public function test_instance_options_override_config_and_keep_unspecified_keys(): void
    {
        config([
            'richtext.images' => ['enabled' => true, 'allowed_formats' => ['jpg', 'jpeg', 'png', 'webp'], 'max_size' => 5, 'allow_alt' => true, 'allow_classes' => true, 'allow_dimensions' => true],
            'richtext.files' => ['enabled' => true, 'allowed_formats' => ['pdf', 'docx'], 'max_size' => 10],
        ]);

        $resolved = $this->resolver()->resolve(['images' => ['allowed_formats' => ['png', 'webp'], 'max_size' => 2]]);

        $this->assertSame(['png', 'webp'], $resolved['images']['allowed_formats']);
        $this->assertSame(2, $resolved['images']['max_size']);
        $this->assertTrue($resolved['images']['enabled']);
        $this->assertTrue($resolved['images']['allow_alt']);
        $this->assertTrue($resolved['images']['require_alt']);
        $this->assertEquals(['enabled' => true, 'allowed_formats' => ['pdf', 'docx'], 'max_size' => 10, 'allowed_mimes' => ConfigResolver::defaults()['files']['allowed_mimes']], $resolved['files']);
    }

    public function test_explicit_false_and_zero_are_respected(): void
    {
        config(['richtext.images.allow_alt' => true]);

        $resolved = $this->resolver()->resolve([
            'images' => ['allow_alt' => false, 'max_size' => 0],
            'limits' => ['min_chars' => 0, 'max_chars' => 0],
            'counter' => ['show' => false],
        ]);

        $this->assertFalse($resolved['images']['allow_alt']);
        $this->assertSame(0, $resolved['images']['max_size']);
        $this->assertSame(0, $resolved['limits']['min_chars']);
        $this->assertSame(0, $resolved['limits']['max_chars']);
        $this->assertFalse($resolved['counter']['show']);
    }

    public function test_null_clears_an_inherited_nullable_value(): void
    {
        config(['richtext.limits.max_chars' => 5000]);

        $this->assertNull($this->resolver()->resolve(['limits' => ['max_chars' => null]])['limits']['max_chars']);
    }

    public function test_empty_lists_mean_none_and_never_restore_defaults(): void
    {
        $resolved = $this->resolver()->resolve(['toolbar' => [], 'images' => ['allowed_formats' => []], 'headings' => []]);

        $this->assertSame([], $resolved['toolbar']);
        $this->assertSame([], $resolved['images']['allowed_formats']);
        $this->assertSame([], $resolved['headings']);

        // Maps are replaced as a whole too, so presets can be removed.
        $this->assertSame([], $this->resolver()->resolve(['tables' => ['presets' => []]])['tables']['presets']);
    }

    public function test_empty_section_array_changes_nothing(): void
    {
        $this->assertSame($this->resolver()->resolve()['images'], $this->resolver()->resolve(['images' => []])['images']);
    }

    public function test_boolean_shorthand_and_camel_case_aliases(): void
    {
        $resolved = $this->resolver()->resolve([
            'markdown' => true,
            'plainText' => true,
            'codeView' => false,
            'images' => false,
            'files' => true,
            'tables' => true,
        ]);

        $this->assertTrue($resolved['markdown']['enabled']);
        $this->assertTrue($resolved['markdown']['preview']);
        $this->assertTrue($resolved['plain_text']['enabled']);
        $this->assertFalse($resolved['code_view']['enabled']);
        $this->assertFalse($resolved['images']['enabled']);
        $this->assertTrue($resolved['images']['allow_alt']);
        $this->assertTrue($resolved['files']['enabled']);
    }

    public function test_unknown_option_keys_throw_by_default(): void
    {
        $this->expectException(InvalidOptionException::class);
        $this->expectExceptionMessage('Unknown InertiaPixel Rich Text Editor option [images.allowed_formatz].');

        $this->resolver()->resolve(['images' => ['allowed_formatz' => ['png']]]);
    }

    public function test_unknown_option_keys_can_be_ignored(): void
    {
        config(['richtext.unknown_options' => 'ignore']);

        $resolved = $this->resolver()->resolve(['nope' => true, 'images' => ['allowed_formatz' => ['png']]]);

        $this->assertArrayNotHasKey('nope', $resolved);
        $this->assertArrayNotHasKey('allowed_formatz', $resolved['images']);
    }

    public function test_unknown_keys_in_the_config_file_are_ignored(): void
    {
        config(['richtext.removed_in_v2' => true, 'richtext.images.old_key' => 1]);

        $resolved = $this->resolver()->resolve();

        $this->assertArrayNotHasKey('removed_in_v2', $resolved);
        $this->assertArrayNotHasKey('old_key', $resolved['images']);
    }

    public function test_server_only_options_cannot_be_set_per_instance(): void
    {
        foreach ([['uploads' => ['disk' => 's3']], ['uploads' => ['route' => ['middleware' => []]]], ['assets' => ['mode' => 'manual']], ['unknown_options' => 'ignore']] as $options) {
            try {
                $this->resolver()->resolve($options);
                $this->fail('Expected a config-only option to be rejected: '.json_encode($options));
            } catch (InvalidOptionException $exception) {
                $this->assertStringContainsString('can only be set in config/richtext.php', $exception->getMessage());
            }
        }
    }

    public function test_option_types_are_validated(): void
    {
        foreach ([
            ['images' => ['enabled' => 'yes']],
            ['limits' => ['max_chars' => -1]],
            ['toolbar' => ['bold', 'explode']],
            ['default_mode' => 'wysiwyg'],
            ['min_height' => '10 parsecs'],
            ['images' => 'on'],
            ['headings' => [7]],
        ] as $options) {
            try {
                $this->resolver()->resolve($options);
                $this->fail('Expected invalid options to be rejected: '.json_encode($options));
            } catch (InvalidOptionException $exception) {
                $this->assertStringContainsString('Invalid value for InertiaPixel Rich Text Editor option', $exception->getMessage());
            }
        }
    }

    public function test_dedicated_attributes_take_precedence_over_options(): void
    {
        $resolved = $this->resolver()->resolve(['limits' => ['max_chars' => 10]], ['limits' => ['max_chars' => 20]]);

        $this->assertSame(20, $resolved['limits']['max_chars']);
    }

    public function test_resolving_never_mutates_global_configuration(): void
    {
        $before = config('richtext');

        $this->resolver()->resolve(['images' => ['max_size' => 1, 'allowed_formats' => ['png']], 'toolbar' => []]);
        $this->render('<x-inertiapixel::rich-text-editor name="a" :options="[\'images\' => [\'max_size\' => 1]]" /><x-inertiapixel::rich-text-editor name="b" :options="[\'markdown\' => true]" />');

        $this->assertSame($before, config('richtext'));
        $this->assertSame(5, $this->resolver()->resolve()['images']['max_size']);
    }
}
