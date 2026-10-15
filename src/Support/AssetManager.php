<?php

namespace InertiaPixel\RichTextEditor\Support;

use Illuminate\Contracts\Config\Repository;
use Illuminate\Support\Facades\Vite;

/**
 * Resolves asset URLs and renders the <link>/<script> tags once per request.
 *
 * Bound as a scoped service, so the "already rendered" state resets
 * between requests (including under Octane).
 */
final class AssetManager
{
    public const ROUTE_NAME = 'inertiapixel.rich-text-editor.asset';

    public const PUBLISH_PATH = 'vendor/inertiapixel/rich-text-editor';

    /** Public asset name => file in resources/dist. */
    public const FILES = [
        'editor.js' => 'inertiapixel-rich-text-editor.js',
        'editor.css' => 'inertiapixel-rich-text-editor.css',
        'content.css' => 'inertiapixel-rich-text-content.css',
    ];

    /** @var array<string, string> */
    private static array $versions = [];

    private bool $editorRendered = false;

    private bool $contentRendered = false;

    public function __construct(private readonly Repository $config)
    {
    }

    public static function distPath(string $asset): string
    {
        return dirname(__DIR__, 2).'/resources/dist/'.self::FILES[$asset];
    }

    public static function version(string $asset): string
    {
        return self::$versions[$asset] ??= substr((string) md5_file(self::distPath($asset)), 0, 12);
    }

    public function mode(): string
    {
        return (string) $this->config->get('richtext.assets.mode', 'route');
    }

    public function autoInject(): bool
    {
        return (bool) $this->config->get('richtext.assets.auto_inject', true) && $this->mode() !== 'manual';
    }

    public function url(string $asset): string
    {
        $version = self::version($asset);

        if ($this->mode() === 'published') {
            $base = $this->config->get('richtext.assets.url');
            $path = self::PUBLISH_PATH.'/'.self::FILES[$asset];
            $url = is_string($base) && $base !== '' ? rtrim($base, '/').'/'.self::FILES[$asset] : asset($path);

            return $url.'?v='.$version;
        }

        return route(self::ROUTE_NAME, ['file' => $asset, 'v' => $version]);
    }

    /**
     * Editor stylesheet and script. Rendered at most once per request.
     */
    public function editorTags(bool $force = false): string
    {
        if ($this->editorRendered || ($this->mode() === 'manual' && ! $force)) {
            return '';
        }

        $this->editorRendered = true;
        // The editor stylesheet already contains the content styles.
        $this->contentRendered = true;

        $nonce = $this->nonceAttribute();

        return '<link rel="stylesheet" href="'.e($this->url('editor.css')).'" data-ipx-rte-asset="editor-css"'.$nonce.'>'
            ."\n".'<script src="'.e($this->url('editor.js')).'" defer data-ipx-rte-asset="editor-js"'.$nonce.'></script>';
    }

    /**
     * Content-only stylesheet for pages that display saved content.
     */
    public function contentTags(bool $force = false): string
    {
        if ($this->contentRendered || ($this->mode() === 'manual' && ! $force)) {
            return '';
        }

        $this->contentRendered = true;

        return '<link rel="stylesheet" href="'.e($this->url('content.css')).'" data-ipx-rte-asset="content-css"'.$this->nonceAttribute().'>';
    }

    private function nonceAttribute(): string
    {
        $nonce = class_exists(Vite::class) ? Vite::cspNonce() : null;

        return is_string($nonce) && $nonce !== '' ? ' nonce="'.e($nonce).'"' : '';
    }
}
