<?php

namespace InertiaPixel\RichTextEditor\Tests\Feature;

use Illuminate\Support\Facades\Validator;
use InertiaPixel\RichTextEditor\Rules\RichTextLength;
use InertiaPixel\RichTextEditor\Tests\TestCase;

class ValidationTest extends TestCase
{
    public function test_laravel_string_rules_count_markup_but_the_package_rule_counts_visible_text(): void
    {
        $html = '<p><a href="https://example.com/a/long/url">Hi</a></p>';

        // Laravel's max rule measures the raw string, tags included.
        $this->assertTrue(Validator::make(['content' => $html], ['content' => ['string', 'max:10']])->fails());

        // The visible text is only "Hi".
        $this->assertTrue(Validator::make(['content' => $html], ['content' => ['string', RichTextLength::max(10)]])->passes());
        $this->assertSame(2, RichTextLength::measure($html));
    }

    public function test_minimum_and_maximum_messages(): void
    {
        $validator = Validator::make(['content' => '<p>short</p>'], ['content' => [RichTextLength::between(10, 20)]]);

        $this->assertTrue($validator->fails());
        $this->assertSame('The content field must contain at least 10 characters.', $validator->errors()->first('content'));

        $validator = Validator::make(['content' => '<p>'.str_repeat('a', 21).'</p>'], ['content' => [RichTextLength::between(10, 20)]]);
        $this->assertSame('The content field must not contain more than 20 characters.', $validator->errors()->first('content'));
    }

    public function test_counts_unicode_code_points(): void
    {
        $this->assertSame(1, RichTextLength::measure('<p>👍</p>'));
        $this->assertSame(5, RichTextLength::measure('<p>👨‍👩‍👧</p>'));
        $this->assertTrue(Validator::make(['c' => '<p>éé</p>'], ['c' => [RichTextLength::max(2)]])->passes());
    }

    public function test_markdown_and_text_count_source_with_normalized_line_breaks(): void
    {
        // Browsers submit textarea line breaks as CRLF.
        $markdown = "**a**\r\nb";

        $this->assertSame(7, RichTextLength::measure($markdown, 'markdown'));
        $this->assertTrue(Validator::make(['c' => $markdown], ['c' => [RichTextLength::max(7)->format('markdown')]])->passes());
        $this->assertTrue(Validator::make(['c' => $markdown], ['c' => [RichTextLength::max(6)->format('text')]])->fails());
    }

    public function test_unknown_formats_are_measured_as_html(): void
    {
        $this->assertTrue(Validator::make(['c' => '<p>abc</p>'], ['c' => [RichTextLength::max(3)->format('docx')]])->passes());
    }

    public function test_non_strings_fail(): void
    {
        $validator = Validator::make(['c' => ['x']], ['c' => [RichTextLength::max(3)]]);

        $this->assertTrue($validator->fails());
        $this->assertSame('The c field must be text.', $validator->errors()->first('c'));
    }

    public function test_documented_controller_example(): void
    {
        $data = ['content' => '<p>'.str_repeat('word ', 30).'</p>', 'content_format' => 'html'];

        $validator = Validator::make($data, [
            'content' => ['required', 'string', RichTextLength::between(100, 5000)->format($data['content_format'])],
            'content_format' => ['required', 'in:html,markdown,text'],
        ]);

        $this->assertTrue($validator->passes());
    }
}
