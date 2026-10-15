<?php

namespace InertiaPixel\RichTextEditor\Tests\Feature;

use InertiaPixel\RichTextEditor\Tests\TestCase;

class ContentRenderingTest extends TestCase
{
    public function test_renders_sanitized_html_inside_the_content_class(): void
    {
        $html = $this->render('<x-inertiapixel::rich-text-content :content="$c" class="prose" />', ['c' => '<p onclick="x">Hi <b>there</b></p><script>alert(1)</script>']);

        $this->assertStringContainsString('<div class="ipx-rte-content prose"><p>Hi <strong>there</strong></p></div>', $html);
        $this->assertStringContainsString('data-ipx-rte-asset="content-css"', $html);
    }

    public function test_renders_markdown_with_raw_html_escaped(): void
    {
        $html = $this->render('<x-inertiapixel::rich-text-content :content="$c" format="markdown" />', ['c' => "# Title\n\nText with <img src=x onerror=alert(1)> and [bad](javascript:alert(1)) and **bold**"]);

        $this->assertStringContainsString('<h1>Title</h1>', $html);
        $this->assertStringContainsString('&lt;img src=x onerror=alert(1)&gt;', $html);
        $this->assertStringContainsString('<strong>bold</strong>', $html);
        $this->assertStringNotContainsString('javascript:', $html);
        $this->assertStringNotContainsString('<img', $html);
    }

    public function test_renders_plain_text_as_escaped_paragraphs(): void
    {
        $html = $this->render('<x-inertiapixel::rich-text-content :content="$c" format="text" />', ['c' => "a <b>\r\nb\n\nc"]);

        $this->assertStringContainsString('<p>a &lt;b&gt;<br>'."\n".'b</p><p>c</p>', $html);
    }

    public function test_content_styles_are_not_repeated_after_the_editor_assets(): void
    {
        $html = $this->render('<x-inertiapixel::rich-text-editor name="a" /><x-inertiapixel::rich-text-content content="<p>x</p>" /><x-inertiapixel::rich-text-content content="<p>y</p>" />');

        $this->assertStringNotContainsString('content-css', $html);
        $this->assertSame(1, substr_count($html, 'editor-css'));

        $this->app->forgetScopedInstances();
        $this->assertSame(1, substr_count($this->render('<x-inertiapixel::rich-text-content content="a" /><x-inertiapixel::rich-text-content content="b" />@inertiapixelRichTextContentStyles'), 'content-css'));
    }

    public function test_rejects_unknown_formats(): void
    {
        $this->expectExceptionMessage('The content "format" must be one of [html, markdown, text].');

        $this->render('<x-inertiapixel::rich-text-content content="x" format="docx" />');
    }
}
