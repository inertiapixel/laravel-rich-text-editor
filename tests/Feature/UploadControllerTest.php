<?php

namespace InertiaPixel\RichTextEditor\Tests\Feature;

use Illuminate\Foundation\Auth\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use InertiaPixel\RichTextEditor\Tests\TestCase;

class UploadControllerTest extends TestCase
{
    private const URI = '/inertiapixel/rich-text-editor/uploads';

    /**
     * The built-in route is opt-in, so enable it before the provider boots.
     */
    protected function defineEnvironment($app): void
    {
        $app['config']->set('richtext.uploads.route.enabled', true);
        $app['config']->set('richtext.uploads.route.middleware', ['web', 'auth']);
        $app['config']->set('richtext.files.enabled', true);
    }

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('public');
    }

    private function user(): User
    {
        $user = new User();
        $user->forceFill(['id' => 1, 'name' => 'Editor', 'email' => 'editor@example.com']);

        return $user;
    }

    private function png(string $name = 'photo.png'): UploadedFile
    {
        return UploadedFile::fake()->image($name, 10, 10);
    }

    public function test_requires_authentication(): void
    {
        $this->postJson(self::URI, ['file' => $this->png(), 'type' => 'image'])->assertUnauthorized();
    }

    public function test_stores_an_image_and_returns_the_documented_contract(): void
    {
        $response = $this->actingAs($this->user())->postJson(self::URI, ['file' => $this->png(), 'type' => 'image']);

        $response->assertCreated()->assertJsonStructure(['url', 'name', 'size', 'mime', 'type']);
        $response->assertJson(['name' => 'photo.png', 'mime' => 'image/png', 'type' => 'image']);

        $files = Storage::disk('public')->allFiles('rich-text-editor');
        $this->assertCount(1, $files);
        $this->assertMatchesRegularExpression('#^rich-text-editor/[A-Za-z0-9]{40}\.png$#', $files[0]);
        $this->assertStringEndsWith($files[0], $response->json('url'));
    }

    public function test_rejects_disallowed_extensions_and_content(): void
    {
        $user = $this->user();

        $this->actingAs($user)->postJson(self::URI, ['file' => UploadedFile::fake()->createWithContent('shell.php', '<?php echo 1;'), 'type' => 'image'])->assertUnprocessable()->assertJsonValidationErrors('file');
        $this->actingAs($user)->postJson(self::URI, ['file' => UploadedFile::fake()->createWithContent('x.svg', '<svg onload="alert(1)"/>'), 'type' => 'image'])->assertUnprocessable();

        // A PHP file renamed to .png is rejected by its real MIME type.
        $this->actingAs($user)->postJson(self::URI, ['file' => UploadedFile::fake()->createWithContent('fake.png', '<?php echo 1;'), 'type' => 'image'])->assertUnprocessable();

        $this->assertSame([], Storage::disk('public')->allFiles());
    }

    public function test_enforces_the_size_limit(): void
    {
        config(['richtext.images.max_size' => 0.001]);

        $this->actingAs($this->user())->postJson(self::URI, ['file' => UploadedFile::fake()->image('big.png')->size(100), 'type' => 'image'])->assertUnprocessable();
    }

    public function test_client_supplied_options_cannot_widen_server_rules(): void
    {
        $response = $this->actingAs($this->user())->postJson(self::URI, [
            'file' => UploadedFile::fake()->createWithContent('run.exe', 'MZ'),
            'type' => 'file',
            'options' => ['files' => ['allowed_formats' => ['exe'], 'max_size' => 1000]],
            'allowed_formats' => ['exe'],
        ]);

        $response->assertUnprocessable();
        $this->assertSame([], Storage::disk('public')->allFiles());
    }

    public function test_uploads_attachments_when_files_are_enabled(): void
    {
        $response = $this->actingAs($this->user())->postJson(self::URI, ['file' => UploadedFile::fake()->createWithContent('notes.txt', 'hello'), 'type' => 'file']);

        $response->assertCreated()->assertJson(['name' => 'notes.txt', 'type' => 'file']);
    }

    public function test_disabled_features_are_forbidden(): void
    {
        config(['richtext.files.enabled' => false, 'richtext.images.upload' => false]);

        $this->actingAs($this->user())->postJson(self::URI, ['file' => UploadedFile::fake()->createWithContent('notes.txt', 'x'), 'type' => 'file'])->assertForbidden();
        $this->actingAs($this->user())->postJson(self::URI, ['file' => $this->png(), 'type' => 'image'])->assertForbidden();
    }

    public function test_optional_gate_is_enforced(): void
    {
        config(['richtext.uploads.route.gate' => 'upload-editor-files']);
        Gate::define('upload-editor-files', fn ($user) => false);

        $this->actingAs($this->user())->postJson(self::URI, ['file' => $this->png(), 'type' => 'image'])->assertForbidden();

        Gate::define('upload-editor-files', fn ($user) => true);
        $this->actingAs($this->user())->postJson(self::URI, ['file' => $this->png(), 'type' => 'image'])->assertCreated();
    }

    public function test_route_url_reaches_the_editor(): void
    {
        $html = $this->render('<x-inertiapixel::rich-text-editor name="content" />');

        $this->assertSame(self::URI, $this->clientConfig($html)['upload']['url']);
    }
}
