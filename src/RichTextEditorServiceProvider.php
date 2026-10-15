<?php

namespace InertiaPixel\RichTextEditor;

use Illuminate\Contracts\Foundation\CachesRoutes;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use InertiaPixel\RichTextEditor\Http\Controllers\AssetController;
use InertiaPixel\RichTextEditor\Http\Controllers\UploadController;
use InertiaPixel\RichTextEditor\Support\AssetManager;
use InertiaPixel\RichTextEditor\Support\ConfigResolver;
use InertiaPixel\RichTextEditor\Support\InstanceRegistry;

class RichTextEditorServiceProvider extends ServiceProvider
{
    public const NAME = 'inertiapixel-rich-text-editor';

    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/richtext.php', 'richtext');

        $this->app->bind(ConfigResolver::class, fn ($app) => new ConfigResolver($app->make('config')));
        $this->app->scoped(AssetManager::class, fn ($app) => new AssetManager($app->make('config')));
        $this->app->scoped(InstanceRegistry::class);
    }

    public function boot(): void
    {
        $this->loadViewsFrom(__DIR__.'/../resources/views', self::NAME);
        $this->loadTranslationsFrom(__DIR__.'/../resources/lang', self::NAME);

        Blade::componentNamespace('InertiaPixel\\RichTextEditor\\Components', 'inertiapixel');

        Blade::directive('inertiapixelRichTextEditorAssets', fn () => '<?php echo app(\\'.AssetManager::class.'::class)->editorTags(true); ?>');
        Blade::directive('inertiapixelRichTextContentStyles', fn () => '<?php echo app(\\'.AssetManager::class.'::class)->contentTags(true); ?>');

        $this->registerRoutes();

        if ($this->app->runningInConsole()) {
            $this->registerPublishing();
        }
    }

    private function registerRoutes(): void
    {
        if ($this->app instanceof CachesRoutes && $this->app->routesAreCached()) {
            return;
        }

        $config = $this->app->make('config');
        $prefix = trim((string) $config->get('richtext.assets.route_prefix', 'inertiapixel/rich-text-editor/assets'), '/');

        // Assets are served without the "web" middleware group: no session,
        // cookies or CSRF are needed for static files.
        Route::get($prefix.'/{file}', AssetController::class)
            ->where('file', 'editor\.js|editor\.css|content\.css')
            ->name(AssetManager::ROUTE_NAME);

        // A published config may contain only part of this section; fill
        // the remaining keys from the package defaults.
        $upload = (array) $config->get('richtext.uploads.route', []) + ConfigResolver::defaults()['uploads']['route'];

        if ($upload['enabled'] === true) {
            Route::post(trim((string) $upload['uri'], '/'), UploadController::class)
                ->middleware((array) $upload['middleware'])
                ->name((string) $upload['name']);
        }

        // Names are assigned after the routes were added to the collection.
        Route::getRoutes()->refreshNameLookups();
    }

    private function registerPublishing(): void
    {
        $this->publishes([
            __DIR__.'/../config/richtext.php' => config_path('richtext.php'),
        ], self::NAME.'-config');

        $this->publishes([
            __DIR__.'/../resources/dist' => public_path(AssetManager::PUBLISH_PATH),
        ], self::NAME.'-assets');

        $this->publishes([
            __DIR__.'/../resources/views' => resource_path('views/vendor/'.self::NAME),
        ], self::NAME.'-views');

        $this->publishes([
            __DIR__.'/../resources/lang' => $this->app->langPath('vendor/'.self::NAME),
        ], self::NAME.'-lang');
    }
}
