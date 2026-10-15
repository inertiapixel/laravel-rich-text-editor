<?php

namespace InertiaPixel\RichTextEditor\Tests\Unit;

use Illuminate\Support\ServiceProvider;
use InertiaPixel\RichTextEditor\Components\RichTextContent;
use InertiaPixel\RichTextEditor\Components\RichTextEditor;
use InertiaPixel\RichTextEditor\RichTextEditorServiceProvider;
use InertiaPixel\RichTextEditor\Rules\RichTextLength;
use InertiaPixel\RichTextEditor\Support\HtmlSanitizer;
use PHPUnit\Framework\TestCase;

class ComposerMetadataTest extends TestCase
{
    /** @return array<string, mixed> */
    private function composer(): array
    {
        return json_decode((string) file_get_contents(dirname(__DIR__, 2).'/composer.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    public function test_package_identity(): void
    {
        $composer = $this->composer();

        $this->assertSame('inertiapixel/laravel-rich-text-editor', $composer['name']);
        $this->assertSame('library', $composer['type']);
        $this->assertSame(['InertiaPixel\\RichTextEditor\\' => 'src/'], $composer['autoload']['psr-4']);
    }

    public function test_service_provider_is_auto_discovered(): void
    {
        $providers = $this->composer()['extra']['laravel']['providers'];

        $this->assertSame([RichTextEditorServiceProvider::class], $providers);
        $this->assertTrue(is_subclass_of($providers[0], ServiceProvider::class));
    }

    public function test_runtime_dependencies_are_limited_to_php_and_laravel(): void
    {
        foreach (array_keys($this->composer()['require']) as $package) {
            $this->assertMatchesRegularExpression('/^(php|ext-[a-z]+|illuminate\/[a-z-]+)$/', $package, "Unexpected runtime dependency [{$package}].");
        }
    }

    public function test_classes_autoload(): void
    {
        foreach ([RichTextEditorServiceProvider::class, RichTextEditor::class, RichTextContent::class, RichTextLength::class, HtmlSanitizer::class] as $class) {
            $this->assertTrue(class_exists($class), "{$class} does not autoload.");
        }
    }

    public function test_compiled_assets_ship_with_the_package(): void
    {
        $dist = dirname(__DIR__, 2).'/resources/dist';
        $js = (string) file_get_contents("{$dist}/inertiapixel-rich-text-editor.js");

        $this->assertStringContainsString('"use strict";', $js);
        $this->assertStringContainsString('InertiaPixelRichTextEditor', $js);
        $this->assertStringNotContainsString('execCommand', $js);
        $this->assertGreaterThan(1000, filesize("{$dist}/inertiapixel-rich-text-editor.css"));
        $this->assertGreaterThan(1000, filesize("{$dist}/inertiapixel-rich-text-content.css"));

        $attributes = (string) file_get_contents(dirname(__DIR__, 2).'/.gitattributes');
        $this->assertStringNotContainsString('/resources/dist export-ignore', $attributes);
    }

    public function test_stylesheets_are_scoped_to_package_classes(): void
    {
        foreach (['editor.css', 'content.css'] as $file) {
            $css = (string) file_get_contents(dirname(__DIR__, 2)."/resources/css/{$file}");
            $css = (string) preg_replace('#/\*.*?\*/#s', '', $css);

            preg_match_all('/(^|})\s*([^{}@]+)\{/', $css, $matches);

            foreach ($matches[2] as $selectorList) {
                foreach (explode(',', $selectorList) as $selector) {
                    $selector = trim($selector);

                    if ($selector === '' || preg_match('/^(from|to|\d+%)$/', $selector)) {
                        continue;
                    }

                    // Every rule starts at the editor root, a dialog root or
                    // a content root, never at a bare element or another class.
                    $this->assertMatchesRegularExpression('/^\.ipx-rte(-dialog|-content)?(--[a-z-]+)?(?![\w-])/', $selector, "Unscoped selector [{$selector}] in {$file}.");
                }
            }
        }
    }
}
