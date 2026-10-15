<?php

namespace InertiaPixel\RichTextEditor\Tests\Unit;

use InertiaPixel\RichTextEditor\Support\VisibleText;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class VisibleTextTest extends TestCase
{
    /**
     * The same fixtures are used by the browser tests for the JavaScript
     * counter, so server and client always agree.
     *
     * @return iterable<string, array{string, string, int}>
     */
    public static function fixtures(): iterable
    {
        $cases = json_decode((string) file_get_contents(dirname(__DIR__).'/fixtures/visible-text.json'), true, 512, JSON_THROW_ON_ERROR);

        foreach ($cases as $case) {
            yield $case['name'] => [$case['html'], $case['text'], $case['count']];
        }
    }

    #[DataProvider('fixtures')]
    public function test_matches_the_editor_counter(string $html, string $text, int $count): void
    {
        $this->assertSame($text, VisibleText::extract($html));
        $this->assertSame($count, VisibleText::length($html));
    }

    public function test_counts_words(): void
    {
        $this->assertSame(4, VisibleText::words('<p>One <strong>two</strong></p><ul><li>three four</li></ul>'));
        $this->assertSame(0, VisibleText::words('<p><br></p>'));
    }

    public function test_void_elements_never_hide_following_text(): void
    {
        $this->assertSame("a\nb", VisibleText::extract('<embed src="x"><p>a</p><source src="y"><p>b</p>'));
    }

    public function test_handles_malformed_markup(): void
    {
        $this->assertSame('ab', VisibleText::extract('<p>a<b>b'));
        $this->assertSame('', VisibleText::extract(''));
    }
}
