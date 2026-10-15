<?php

namespace InertiaPixel\RichTextEditor\Tests\Feature;

use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Route;
use InertiaPixel\RichTextEditor\RichTextEditorServiceProvider;
use InertiaPixel\RichTextEditor\Support\AssetManager;
use InertiaPixel\RichTextEditor\Tests\TestCase;

class ServiceProviderTest extends TestCase
{
    public function test_provider_is_registered_and_config_is_available_without_publishing(): void
    {
        $this->assertArrayHasKey(RichTextEditorServiceProvider::class, $this->app->getLoadedProviders());
        $this->assertSame('rich', config('richtext.default_mode'));
        $this->assertSame('route', config('richtext.assets.mode'));
    }

    public function test_views_translations_and_components_are_registered(): void
    {
        $this->assertTrue(view()->exists('inertiapixel-rich-text-editor::components.rich-text-editor'));
        $this->assertTrue(view()->exists('inertiapixel-rich-text-editor::components.rich-text-content'));
        $this->assertSame('Bold', __('inertiapixel-rich-text-editor::editor.bold'));
        $this->assertStringContainsString('data-ipx-rte', $this->render('<x-inertiapixel::rich-text-editor name="x" />'));
    }

    public function test_asset_route_serves_versioned_files(): void
    {
        $this->assertTrue(Route::has(AssetManager::ROUTE_NAME));

        foreach (['editor.js' => 'application/javascript', 'editor.css' => 'text/css', 'content.css' => 'text/css'] as $file => $type) {
            $version = AssetManager::version($file);
            $response = $this->get("/inertiapixel/rich-text-editor/assets/{$file}?v={$version}");

            $response->assertOk();
            $this->assertStringStartsWith($type, $response->headers->get('Content-Type'));
            $this->assertStringContainsString('immutable', (string) $response->headers->get('Cache-Control'));
            $this->assertSame('nosniff', $response->headers->get('X-Content-Type-Options'));
            $this->assertSame(file_get_contents(AssetManager::distPath($file)), $response->streamedContent());
        }
    }

    public function test_asset_route_supports_conditional_requests_and_rejects_unknown_files(): void
    {
        $first = $this->get('/inertiapixel/rich-text-editor/assets/editor.js');
        $first->assertOk();
        $this->assertStringNotContainsString('immutable', (string) $first->headers->get('Cache-Control'));

        $this->get('/inertiapixel/rich-text-editor/assets/editor.js', ['If-None-Match' => $first->headers->get('ETag')])->assertStatus(304);
        $this->get('/inertiapixel/rich-text-editor/assets/..%2Fcomposer.json')->assertNotFound();
        $this->get('/inertiapixel/rich-text-editor/assets/other.js')->assertNotFound();
    }

    public function test_asset_route_does_not_start_a_session(): void
    {
        $response = $this->get('/inertiapixel/rich-text-editor/assets/editor.css');

        $this->assertEmpty($response->headers->getCookies());
    }

    public function test_published_asset_mode_uses_public_urls(): void
    {
        config(['richtext.assets.mode' => 'published']);
        $html = $this->render('<x-inertiapixel::rich-text-editor name="x" />');

        $this->assertStringContainsString('http://localhost/vendor/inertiapixel/rich-text-editor/inertiapixel-rich-text-editor.js?v=', $html);

        config(['richtext.assets.url' => 'https://cdn.example.com/rte/']);
        $this->app->forgetScopedInstances();

        $this->assertStringContainsString('https://cdn.example.com/rte/inertiapixel-rich-text-editor.css?v=', $this->render('<x-inertiapixel::rich-text-editor name="y" />'));
    }

    public function test_upload_route_is_not_registered_by_default(): void
    {
        $this->assertFalse(Route::has('inertiapixel.rich-text-editor.upload'));
        $this->post('/inertiapixel/rich-text-editor/uploads')->assertNotFound();
    }

    public function test_config_and_assets_can_be_published(): void
    {
        $config = config_path('richtext.php');
        $assets = public_path('vendor/inertiapixel/rich-text-editor');

        File::delete($config);
        File::deleteDirectory($assets);

        try {
            $this->artisan('vendor:publish', ['--tag' => 'inertiapixel-rich-text-editor-config'])->assertSuccessful();
            $this->artisan('vendor:publish', ['--tag' => 'inertiapixel-rich-text-editor-assets'])->assertSuccessful();

            $this->assertFileEquals(dirname(__DIR__, 2).'/config/richtext.php', $config);
            $this->assertFileEquals(AssetManager::distPath('editor.js'), "{$assets}/inertiapixel-rich-text-editor.js");
            $this->assertFileExists("{$assets}/inertiapixel-rich-text-content.css");
        } finally {
            File::delete($config);
            File::deleteDirectory($assets);
        }
    }
}
