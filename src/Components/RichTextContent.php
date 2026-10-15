<?php

namespace InertiaPixel\RichTextEditor\Components;

use Illuminate\Contracts\View\View;
use Illuminate\Support\Str;
use Illuminate\View\Component;
use InertiaPixel\RichTextEditor\RichTextEditorServiceProvider;
use InertiaPixel\RichTextEditor\Support\AssetManager;
use InertiaPixel\RichTextEditor\Support\HtmlSanitizer;
use InertiaPixel\RichTextEditor\Support\InvalidOptionException;

/**
 * Renders saved editor content safely inside .ipx-rte-content:
 *
 *     <x-inertiapixel::rich-text-content :content="$post->body" :format="$post->body_format" />
 *
 * HTML is sanitized with the package allowlist; Markdown is rendered by
 * Laravel's Str::markdown() with raw HTML escaped and unsafe links
 * removed, then sanitized; plain text is escaped and split into
 * paragraphs.
 */
class RichTextContent extends Component
{
    public string $html = '';

    public string $styles = '';

    public function __construct(
        public ?string $content = null,
        public ?string $format = 'html',
    ) {
    }

    public function render(): View
    {
        $format = $this->format ?: 'html';

        if (! in_array($format, ['html', 'markdown', 'text'], true)) {
            throw new InvalidOptionException('The content "format" must be one of [html, markdown, text].');
        }

        $this->html = self::toSafeHtml((string) $this->content, $format);

        $assets = app(AssetManager::class);
        $this->styles = $assets->autoInject() ? $assets->contentTags() : '';

        return view(RichTextEditorServiceProvider::NAME.'::components.rich-text-content');
    }

    public static function toSafeHtml(string $content, string $format): string
    {
        if ($format === 'text') {
            return self::textToHtml($content);
        }

        if ($format === 'markdown') {
            $content = (string) Str::markdown($content, [
                'html_input' => 'escape',
                'allow_unsafe_links' => false,
            ]);
        }

        return HtmlSanitizer::clean($content);
    }

    public static function textToHtml(string $text): string
    {
        $paragraphs = preg_split('/\n[ \t]*\n/', str_replace(["\r\n", "\r"], "\n", $text)) ?: [];
        $html = '';

        foreach ($paragraphs as $paragraph) {
            if (trim($paragraph) === '') {
                continue;
            }

            $html .= '<p>'.nl2br(e(trim($paragraph, "\n")), false).'</p>';
        }

        return $html;
    }
}
