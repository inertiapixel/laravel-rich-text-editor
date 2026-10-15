<?php

namespace InertiaPixel\RichTextEditor\Tests\Feature;

use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Vite;
use Illuminate\Support\MessageBag;
use Illuminate\Support\ViewErrorBag;
use InertiaPixel\RichTextEditor\Tests\TestCase;

class ComponentRenderingTest extends TestCase
{
    public function test_basic_usage_needs_only_a_name(): void
    {
        $html = $this->render('<x-inertiapixel::rich-text-editor name="content" />');

        $this->assertStringContainsString('data-ipx-rte', $html);
        $this->assertStringContainsString('class="ipx-rte"', $html);
        $this->assertMatchesRegularExpression('/<textarea\s+id="ipx-rte-content"\s+name="content"/', $html);
        $this->assertStringContainsString('<input type="hidden" name="content_format" value="html" data-ipx-rte-format', $html);
        $this->assertStringContainsString('/inertiapixel/rich-text-editor/assets/editor.js?v=', $html);
        $this->assertStringContainsString('/inertiapixel/rich-text-editor/assets/editor.css?v=', $html);
    }

    public function test_documented_examples_render(): void
    {
        $this->render('<x-inertiapixel::rich-text-editor name="content" :value="old(\'content\', $article->content ?? \'\')" />', ['article' => (object) ['content' => '<p>x</p>']]);

        $html = $this->render(<<<'BLADE'
            <x-inertiapixel::rich-text-editor
                name="content"
                id="article-content"
                :value="old('content', '')"
                placeholder="Write your article..."
                mode="rich"
                min-height="400px"
                :options="[
                    'markdown' => true,
                    'plainText' => true,
                    'codeView' => true,
                    'images' => true,
                    'files' => true,
                    'tables' => true,
                ]"
            />
            BLADE);

        $config = $this->clientConfig($html);

        $this->assertStringContainsString('id="article-content"', $html);
        $this->assertSame(['rich', 'markdown', 'text', 'code'], $config['modes']);
        $this->assertSame('400px', $config['minHeight']);
        $this->assertSame('Write your article...', $config['placeholder']);
        $this->assertTrue($config['files']['enabled']);
        $this->assertContains('file', $config['toolbar']);
    }

    public function test_the_value_is_escaped_and_cannot_break_out_of_the_field(): void
    {
        $value = "\n</textarea><script>alert(1)</script>&amp;";
        $html = $this->render('<x-inertiapixel::rich-text-editor name="content" :value="$value" />', ['value' => $value]);

        $this->assertStringNotContainsString('<script>alert(1)</script>', $html);
        $this->assertStringContainsString("\n\n&lt;/textarea&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;amp;</textarea>", $html);
    }

    public function test_ids_are_unique_and_deterministic(): void
    {
        $html = $this->render('<x-inertiapixel::rich-text-editor name="content" /><x-inertiapixel::rich-text-editor name="content" /><x-inertiapixel::rich-text-editor name="post[body]" /><x-inertiapixel::rich-text-editor name="x" id="custom" />');

        foreach (['ipx-rte-content', 'ipx-rte-content-2', 'ipx-rte-post-body', 'custom'] as $id) {
            $this->assertSame(1, substr_count($html, 'id="'.$id.'"'), "Expected exactly one element with id {$id}.");
            $this->assertSame(1, substr_count($html, 'id="'.$id.'-editor"'));
        }
    }

    public function test_assets_are_rendered_once_per_request(): void
    {
        $html = $this->render('<x-inertiapixel::rich-text-editor name="a" /><x-inertiapixel::rich-text-editor name="b" />@inertiapixelRichTextEditorAssets');

        $this->assertSame(1, substr_count($html, 'data-ipx-rte-asset="editor-js"'));
        $this->assertSame(1, substr_count($html, 'data-ipx-rte-asset="editor-css"'));
    }

    public function test_manual_asset_mode_renders_no_tags_until_the_directive_is_used(): void
    {
        config(['richtext.assets.mode' => 'manual']);

        $this->assertStringNotContainsString('data-ipx-rte-asset', $this->render('<x-inertiapixel::rich-text-editor name="a" />'));
        $this->assertStringContainsString('data-ipx-rte-asset="editor-js"', $this->render('@inertiapixelRichTextEditorAssets'));
    }

    public function test_csp_nonce_is_applied_to_asset_tags(): void
    {
        Vite::useCspNonce('test-nonce');

        $this->assertStringContainsString('nonce="test-nonce"', $this->render('<x-inertiapixel::rich-text-editor name="a" />'));
    }

    public function test_attributes_states_and_classes(): void
    {
        $html = $this->render('<x-inertiapixel::rich-text-editor name="content" class="my-editor &quot;x" required readonly aria-label="Body" placeholder="Type" data-test="1" />');

        $this->assertStringContainsString('class="ipx-rte ipx-rte--readonly my-editor &quot;x"', $html);
        $this->assertStringContainsString('data-test="1"', $html);
        $this->assertMatchesRegularExpression('/<textarea[^>]*\srequired\b/', $html);
        $this->assertMatchesRegularExpression('/<textarea[^>]*\sreadonly\b/', $html);
        $this->assertMatchesRegularExpression('/<textarea[^>]*aria-label="Body"/', $html);

        $config = $this->clientConfig($html);
        $this->assertTrue($config['required']);
        $this->assertTrue($config['readonly']);
        $this->assertFalse($config['disabled']);
        $this->assertSame('Body', $config['ariaLabel']);

        $disabled = $this->render('<x-inertiapixel::rich-text-editor name="content" :disabled="true" readonly="false" />');
        $this->assertMatchesRegularExpression('/<textarea[^>]*\sdisabled\b/', $disabled);
        $this->assertMatchesRegularExpression('/<input type="hidden" name="content_format"[^>]*disabled/', $disabled);
        $this->assertFalse($this->clientConfig($disabled)['readonly']);
    }

    public function test_format_field_names(): void
    {
        $this->assertStringContainsString('name="post[body_format]"', $this->render('<x-inertiapixel::rich-text-editor name="post[body]" />'));
        $this->assertStringNotContainsString('data-ipx-rte-format', $this->render('<x-inertiapixel::rich-text-editor name="blocks[]" />'));
        $this->assertStringNotContainsString('data-ipx-rte-format', $this->render('<x-inertiapixel::rich-text-editor name="a" :options="[\'format_field\' => false]" />'));
        $this->assertStringContainsString('name="body_type"', $this->render('<x-inertiapixel::rich-text-editor name="a" :options="[\'format_field\' => \'body_type\']" />'));
    }

    public function test_toolbar_attribute_accepts_a_string_or_array(): void
    {
        $this->assertSame(['bold', 'italic', '|', 'link'], $this->clientConfig($this->render('<x-inertiapixel::rich-text-editor name="a" toolbar="bold italic | link" />'))['toolbar']);
        $this->assertSame(['undo', 'table'], $this->clientConfig($this->render('<x-inertiapixel::rich-text-editor name="a" :toolbar="[\'undo\', \'table\']" />'))['toolbar']);
        $this->assertSame([], $this->clientConfig($this->render('<x-inertiapixel::rich-text-editor name="a" :toolbar="[]" />'))['toolbar']);
    }

    public function test_toolbar_drops_disabled_features_and_redundant_separators(): void
    {
        $config = $this->clientConfig($this->render('<x-inertiapixel::rich-text-editor name="a" :options="[\'images\' => false, \'tables\' => false]" toolbar="| bold | image table | | link |" />'));

        $this->assertSame(['bold', '|', 'link'], $config['toolbar']);
    }

    public function test_mode_attribute_and_format(): void
    {
        $config = $this->clientConfig($this->render('<x-inertiapixel::rich-text-editor name="a" mode="markdown" :options="[\'markdown\' => true]" />'));
        $this->assertSame('markdown', $config['defaultMode']);
        $this->assertSame('markdown', $config['initialFormat']);

        $config = $this->clientConfig($this->render('<x-inertiapixel::rich-text-editor name="a" format="text" :options="[\'plainText\' => true]" />'));
        $this->assertSame('text', $config['initialFormat']);

        // A default mode that is not enabled falls back to the first enabled one.
        $this->assertSame('rich', $this->clientConfig($this->render('<x-inertiapixel::rich-text-editor name="a" mode="markdown" />'))['defaultMode']);
    }

    public function test_invalid_props_fail_loudly(): void
    {
        $this->expectExceptionMessage('The editor "format" must be one of [html, markdown, text].');

        $this->render('<x-inertiapixel::rich-text-editor name="a" format="docx" />');
    }

    public function test_at_least_one_mode_must_be_enabled(): void
    {
        $this->expectExceptionMessage('At least one InertiaPixel Rich Text Editor mode must be enabled.');

        $this->render('<x-inertiapixel::rich-text-editor name="a" :options="[\'rich_text\' => false, \'code_view\' => false]" />');
    }

    public function test_character_limits_and_counter_props(): void
    {
        config(['richtext.limits.min_chars' => 10, 'richtext.limits.max_chars' => 100]);

        $config = $this->clientConfig($this->render('<x-inertiapixel::rich-text-editor name="a" :max-chars="50" />'));
        $this->assertSame(['min' => 10, 'max' => 50, 'enforceMax' => false, 'validateOnSubmit' => true], $config['limits']);
        $this->assertNull($config['counter']['show']);

        $config = $this->clientConfig($this->render('<x-inertiapixel::rich-text-editor name="b" min-chars="0" max-chars="0" :show-counter="false" />'));
        $this->assertSame(0, $config['limits']['min']);
        $this->assertSame(0, $config['limits']['max']);
        $this->assertFalse($config['counter']['show']);

        $this->expectExceptionMessage('The minimum character limit (60) is greater than the maximum (50).');
        $this->render('<x-inertiapixel::rich-text-editor name="c" :min-chars="60" :max-chars="50" />');
    }

    public function test_client_configuration_never_contains_server_only_settings(): void
    {
        config(['richtext.uploads.disk' => 'secret-disk', 'richtext.uploads.directory' => 'secret-dir', 'richtext.uploads.route.gate' => 'secret-gate']);

        $html = $this->render('<x-inertiapixel::rich-text-editor name="a" upload-url="/upload" />');
        $config = $this->clientConfig($html);

        foreach (['secret-disk', 'secret-dir', 'secret-gate', 'middleware', 'route_prefix', 'auto_inject', 'unknown_options'] as $needle) {
            $this->assertStringNotContainsString($needle, json_encode($config));
        }

        $this->assertSame(['url' => '/upload', 'field' => 'file'], $config['upload']);
        $this->assertTrue($config['images']['uploadReady']);
    }

    public function test_upload_url_resolution(): void
    {
        $config = $this->clientConfig($this->render('<x-inertiapixel::rich-text-editor name="a" />'));
        $this->assertNull($config['upload']['url']);
        $this->assertTrue($config['images']['upload']);
        $this->assertFalse($config['images']['uploadReady']);
        $this->assertNull($config['csrfToken']);

        config(['richtext.uploads.url' => 'https://uploads.example.com/editor']);
        $this->assertSame('https://uploads.example.com/editor', $this->clientConfig($this->render('<x-inertiapixel::rich-text-editor name="b" />'))['upload']['url']);

        $this->expectExceptionMessage('The upload URL must be an absolute http(s) URL or start with "/".');
        $this->render('<x-inertiapixel::rich-text-editor name="c" upload-url="javascript:alert(1)" />');
    }

    public function test_dangerous_upload_formats_are_rejected(): void
    {
        $this->expectExceptionMessage('The file extension [php] in [images.allowed_formats] can execute code and is never allowed.');

        $this->render('<x-inertiapixel::rich-text-editor name="a" :options="[\'images\' => [\'allowed_formats\' => [\'png\', \'PHP\']]]" />');
    }

    public function test_translated_strings_are_passed_to_the_client(): void
    {
        app('translator')->addLines(['editor.bold' => 'Gras'], 'fr', 'inertiapixel-rich-text-editor');
        app()->setLocale('fr');

        $config = $this->clientConfig($this->render('<x-inertiapixel::rich-text-editor name="a" />'));

        $this->assertSame('fr', $config['locale']);
        $this->assertSame('Gras', $config['strings']['bold']);
    }

    public function test_old_input_and_validation_errors(): void
    {
        $this->startSession();
        $this->app['request']->setLaravelSession($this->app['session.store']);
        session()->put('_old_input', ['post' => ['body' => '# Old', 'body_format' => 'markdown']]);
        view()->share('errors', (new ViewErrorBag())->put('default', new MessageBag(['post.body' => ['The body is too short.']])));

        $html = $this->render('<x-inertiapixel::rich-text-editor name="post[body]" value="<p>from database</p>" :options="[\'markdown\' => true]" />');
        $config = $this->clientConfig($html);

        $this->assertStringContainsString("\n# Old</textarea>", $html);
        $this->assertSame('markdown', $config['initialFormat']);
        $this->assertStringContainsString('class="ipx-rte ipx-rte--invalid"', $html);
        $this->assertStringContainsString('aria-invalid="true" aria-describedby="ipx-rte-post-body-error"', $html);
        $this->assertStringContainsString('<p class="ipx-rte__error" id="ipx-rte-post-body-error" data-ipx-rte-server-error>The body is too short.</p>', $html);

        $this->assertStringContainsString("\n&lt;p&gt;from database&lt;/p&gt;</textarea>", $this->render('<x-inertiapixel::rich-text-editor name="post[body]" value="<p>from database</p>" :old-input="false" />'));
    }

    public function test_named_error_bags(): void
    {
        view()->share('errors', (new ViewErrorBag())->put('profile', new MessageBag(['bio' => ['Bio error']])));

        $this->assertStringNotContainsString('Bio error', $this->render('<x-inertiapixel::rich-text-editor name="bio" />'));
        $this->assertStringContainsString('Bio error', $this->render('<x-inertiapixel::rich-text-editor name="bio" error-bag="profile" />'));
    }

    public function test_csrf_token_is_included_only_when_uploads_are_possible(): void
    {
        $this->startSession();
        $this->app['request']->setLaravelSession($this->app['session.store']);

        $this->assertNull($this->clientConfig($this->render('<x-inertiapixel::rich-text-editor name="a" />'))['csrfToken']);
        $this->assertSame(session()->token(), $this->clientConfig($this->render('<x-inertiapixel::rich-text-editor name="b" upload-url="/u" />'))['csrfToken']);
    }

    public function test_upload_route_url_is_used_when_the_built_in_route_exists(): void
    {
        Route::post('/my/upload', fn () => null)->name('inertiapixel.rich-text-editor.upload');
        Route::getRoutes()->refreshNameLookups();
        config(['richtext.uploads.route.enabled' => true]);

        $this->assertSame('/my/upload', $this->clientConfig($this->render('<x-inertiapixel::rich-text-editor name="a" />'))['upload']['url']);
    }
}
