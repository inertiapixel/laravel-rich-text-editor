<?php

/**
 * Renders Blade through a real Laravel application (Orchestra Testbench)
 * for the browser tests. Reads JSON from STDIN:
 *   { "blade": "<x-inertiapixel::rich-text-editor ... />", "config": { "richtext.x": ... }, "data": {} }
 * and prints the rendered HTML.
 */

use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\View;
use Illuminate\Support\MessageBag;
use Illuminate\Support\ViewErrorBag;
use Illuminate\Support\ServiceProvider;
use InertiaPixel\RichTextEditor\RichTextEditorServiceProvider;
use Orchestra\Testbench\Foundation\Application;

require __DIR__.'/../../vendor/autoload.php';

/** Applies the requested configuration before the package registers. */
final class IpxBrowserTestConfigProvider extends ServiceProvider
{
    /** @var array<string, mixed> */
    public static array $config = [];

    public function register(): void
    {
        $this->app['config']->set('app.url', 'http://ipx.test');
        $this->app['config']->set('app.key', 'base64:'.base64_encode(str_repeat('a', 32)));

        foreach (self::$config as $key => $value) {
            $this->app['config']->set($key, $value);
        }
    }
}

$input = json_decode((string) stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);

IpxBrowserTestConfigProvider::$config = $input['config'] ?? [];

$app = Application::create(options: [
    'extra' => [
        'providers' => [IpxBrowserTestConfigProvider::class, RichTextEditorServiceProvider::class],
        'dont-discover' => ['*'],
    ],
]);

$app['url']->forceRootUrl('http://ipx.test');

// Simulate a redirect back after failed validation: old input and errors.
if (isset($input['old']) || isset($input['errors'])) {
    $session = $app['session']->driver();
    $session->put('_old_input', $input['old'] ?? []);
    $app['request']->setLaravelSession($session);

    $bag = new MessageBag($input['errors'] ?? []);
    View::share('errors', (new ViewErrorBag())->put('default', $bag));
}

echo Blade::render($input['blade'], $input['data'] ?? []);
