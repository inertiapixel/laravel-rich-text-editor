<?php

namespace InertiaPixel\RichTextEditor\Tests;

use Illuminate\Support\Facades\Blade;
use InertiaPixel\RichTextEditor\RichTextEditorServiceProvider;
use Orchestra\Testbench\TestCase as Orchestra;

abstract class TestCase extends Orchestra
{
    protected function getPackageProviders($app): array
    {
        return [RichTextEditorServiceProvider::class];
    }

    /**
     * Render Blade and return the HTML.
     *
     * @param  array<string, mixed>  $data
     */
    protected function render(string $template, array $data = []): string
    {
        return Blade::render($template, $data);
    }

    /**
     * Extract the client configuration of the n-th editor in rendered HTML.
     *
     * @return array<string, mixed>
     */
    protected function clientConfig(string $html, int $index = 0): array
    {
        preg_match_all('/data-ipx-rte-config="([^"]*)"/', $html, $matches);

        $this->assertArrayHasKey($index, $matches[1], 'No editor configuration found in the rendered HTML.');

        return json_decode(html_entity_decode($matches[1][$index], ENT_QUOTES | ENT_HTML5), true, 512, JSON_THROW_ON_ERROR);
    }
}
