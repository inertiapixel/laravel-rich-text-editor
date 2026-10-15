<?php

namespace InertiaPixel\RichTextEditor\Tests\Feature;

use InertiaPixel\RichTextEditor\Support\HtmlSanitizer;
use InertiaPixel\RichTextEditor\Tests\TestCase;
use PHPUnit\Framework\Attributes\DataProvider;

class HtmlSanitizerTest extends TestCase
{
    /** @return iterable<string, array{string, string}> */
    public static function cases(): iterable
    {
        yield 'keeps editor output' => [
            '<h2 class="ipx-rte-text-center">T</h2><p>a <strong>b</strong> <em>c</em> <u>d</u> <s>e</s> <code>f</code></p><ul><li>x<ol start="3"><li>y</li></ol></li></ul><blockquote><p>q</p></blockquote><hr>',
            '<h2 class="ipx-rte-text-center">T</h2><p>a <strong>b</strong> <em>c</em> <u>d</u> <s>e</s> <code>f</code></p><ul><li>x<ol start="3"><li>y</li></ol></li></ul><blockquote><p>q</p></blockquote><hr>',
        ];
        yield 'removes scripts and styles with content' => ['<p>a</p><script>alert(1)</script><style>p{}</style>', '<p>a</p>'];
        yield 'removes event handlers and inline styles' => ['<p onclick="x" style="color:red" onmouseover="y">a</p>', '<p>a</p>'];
        yield 'removes javascript links' => ['<p><a href="javascript:alert(1)">x</a></p>', '<p>x</p>'];
        yield 'removes obfuscated javascript links' => ['<p><a href=" java&#x09;script:alert(1)">x</a><a href="JaVaScRiPt:alert(1)">y</a></p>', '<p>xy</p>'];
        yield 'removes data and vbscript links' => ['<p><a href="data:text/html,x">a</a><a href="vbscript:x">b</a></p>', '<p>ab</p>'];
        yield 'removes image handlers and script sources' => ['<p><img src="/a.png" onerror="x" alt="a"><img src="javascript:alert(1)"></p>', '<p><img src="/a.png" alt="a"></p>'];
        yield 'drops embedded and foreign content' => ['<iframe src="x"></iframe><object data="x"></object><embed src="x"><svg onload="x"><circle/></svg><math><mi>x</mi></math><p>ok</p>', '<p>ok</p>'];
        yield 'void elements never swallow following content' => ['<embed src="x"><p>a</p><source src="y"><p>b</p><track src="z"><p>c<wbr>d</p>', '<p>a</p><p>b</p><p>cd</p>'];
        yield 'drops forms' => ['<form><input value="x"><button>b</button><textarea>t</textarea></form><p>ok</p>', '<p>ok</p>'];
        yield 'drops comments' => ['<p>a<!-- secret --></p>', '<p>a</p>'];
        yield 'renames presentational tags' => ['<p><b>a</b><i>b</i><strike>c</strike><del>d</del><ins>e</ins></p>', '<p><strong>a</strong><em>b</em><s>c</s><s>d</s><u>e</u></p>'];
        yield 'unwraps unknown elements' => ['<p><span class="x">a</span><font>b</font><mark>c</mark></p>', '<p>abc</p>'];
        yield 'forces safe link attributes' => ['<p><a href="https://x.test" target="_blank" rel="opener" id="i" class="x">x</a><a href="/y" target="_top">y</a></p>', '<p><a href="https://x.test" target="_blank" rel="noopener noreferrer">x</a><a href="/y">y</a></p>'];
        yield 'keeps attachment links' => ['<p><a class="ipx-rte-attachment evil" href="/f.pdf">f</a></p>', '<p><a class="ipx-rte-attachment" href="/f.pdf">f</a></p>'];
        yield 'filters classes per element' => ['<p class="evil ipx-rte-indent-2 ipx-rte-indent-9">a</p><img src="/a.png" alt="" class="ipx-rte-w-50 ipx-rte-w-51 ipx-rte-img--rounded ipx-rte-img-center x">', '<p class="ipx-rte-indent-2">a</p><img src="/a.png" alt="" class="ipx-rte-w-50 ipx-rte-img--rounded ipx-rte-img-center">'];
        yield 'validates image dimensions' => ['<img src="/a.png" alt="" width="300" height="12px">', '<img src="/a.png" alt="" width="300">'];
        yield 'keeps tables with presets' => ['<table class="ipx-rte-table ipx-rte-table--striped ipx-rte-table--unknown"><thead><tr><th scope="col" class="ipx-rte-text-right" style="x">h</th></tr></thead><tbody><tr><td onclick="x">d</td></tr></tbody></table>', '<table class="ipx-rte-table ipx-rte-table--striped"><thead><tr><th scope="col" class="ipx-rte-text-right">h</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table>'];
        yield 'code blocks keep text only' => ['<pre><code class="language-php hljs"><span>echo</span> "&lt;b&gt;";</code></pre>', '<pre><code class="language-php">echo "&lt;b&gt;";</code></pre>'];
        yield 'keeps figures' => ['<figure class="ipx-rte-figure ipx-rte-img-right"><img src="/a.png" alt="A"><figcaption>Cap</figcaption></figure>', '<figure class="ipx-rte-figure ipx-rte-img-right"><img src="/a.png" alt="A"><figcaption>Cap</figcaption></figure>'];
        yield 'keeps unicode' => ['<p>é 👍 漢字</p>', '<p>é 👍 漢字</p>'];
        yield 'empty input' => ['   ', ''];
    }

    #[DataProvider('cases')]
    public function test_sanitizes(string $input, string $expected): void
    {
        $this->assertSame($expected, HtmlSanitizer::clean($input));
    }

    public function test_never_outputs_styles_or_handlers(): void
    {
        $output = HtmlSanitizer::clean('<div style="x" onclick="y"><p style="a"><span style="b" onmouseover="c">t</span></p><img src="/a.png" style="width:1px" onload="d"><table style="e"><tr><td style="f">1</td></tr></table></div>');

        $this->assertDoesNotMatchRegularExpression('/\sstyle=/i', $output);
        $this->assertDoesNotMatchRegularExpression('/\son[a-z]+=/i', $output);
    }

    public function test_uses_configured_image_classes_and_heading_levels(): void
    {
        config([
            'richtext.images.classes' => ['shadow-lg' => 'Shadow'],
            'richtext.headings' => [2, 3],
        ]);

        $this->assertSame('<h2>a</h2><img src="/a.png" class="shadow-lg" alt="">', HtmlSanitizer::clean('<h1>a</h1><img src="/a.png" class="shadow-lg ipx-rte-img--rounded">'));
    }

    public function test_custom_image_classes_require_opt_in(): void
    {
        $html = '<img src="/a.png" alt="" class="rounded-xl ipx-rte-fake">';

        $this->assertSame('<img src="/a.png" alt="">', HtmlSanitizer::clean($html));

        config(['richtext.images.allow_custom_classes' => true]);

        $this->assertSame('<img src="/a.png" alt="" class="rounded-xl">', HtmlSanitizer::clean($html));
    }

    public function test_data_images_require_opt_in(): void
    {
        $html = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="">';

        $this->assertSame('', HtmlSanitizer::clean($html));

        config(['richtext.paste.allow_data_images' => true]);

        $this->assertSame($html, HtmlSanitizer::clean($html));
    }
}
