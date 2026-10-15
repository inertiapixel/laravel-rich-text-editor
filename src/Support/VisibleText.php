<?php

namespace InertiaPixel\RichTextEditor\Support;

use DOMElement;
use DOMNode;
use DOMText;

/**
 * Extracts the user-visible text of editor HTML and counts it the same way
 * the editor's character counter does (resources/js/serializer.js,
 * extractText). Both implementations are tested against
 * tests/fixtures/visible-text.json.
 *
 * Contract:
 *  1. Block elements and <br> are line breaks. Text in <pre> keeps its
 *     whitespace and its newlines are line breaks.
 *  2. Elsewhere, runs of ASCII whitespace become one space, and each line
 *     is trimmed of spaces. Non-breaking spaces are kept.
 *  3. Empty lines are removed; lines are joined with "\n".
 *  4. Images, scripts, styles and other embedded content contribute nothing.
 *
 * Characters are Unicode code points (mb_strlen); line breaks are not
 * counted.
 */
final class VisibleText
{
    /** @var list<array{text: string, pre: bool}> */
    private array $lines = [];

    /** @var array{text: string, pre: bool} */
    private array $current = ['text' => '', 'pre' => false];

    public static function extract(string $html): string
    {
        $extractor = new self();
        $extractor->walk(Html::body($html), false);
        $extractor->lines[] = $extractor->current;

        $lines = [];

        foreach ($extractor->lines as $line) {
            $text = $line['pre']
                ? $line['text']
                : trim((string) preg_replace('/ {2,}/', ' ', $line['text']), ' ');

            if ($text !== '') {
                $lines[] = $text;
            }
        }

        return implode("\n", $lines);
    }

    /**
     * Visible characters (code points), excluding line breaks.
     */
    public static function length(string $html): int
    {
        return mb_strlen(str_replace("\n", '', self::extract($html)), 'UTF-8');
    }

    public static function words(string $html): int
    {
        $text = trim(self::extract($html));

        return $text === '' ? 0 : count(preg_split('/\s+/u', $text) ?: []);
    }

    private function lineBreak(): void
    {
        $this->lines[] = $this->current;
        $this->current = ['text' => '', 'pre' => false];
    }

    private function walk(DOMNode $node, bool $pre): void
    {
        foreach ($node->childNodes as $child) {
            if ($child instanceof DOMText) {
                $data = str_replace(["\u{200B}", "\u{FEFF}"], '', $child->data);

                if ($pre) {
                    $parts = explode("\n", str_replace(["\r\n", "\r"], "\n", $data));

                    foreach ($parts as $index => $part) {
                        if ($index > 0) {
                            $this->lineBreak();
                        }

                        $this->current['pre'] = true;
                        $this->current['text'] .= $part;
                    }
                } else {
                    $this->current['text'] .= preg_replace('/[\t\n\r\f ]+/', ' ', $data);
                }

                continue;
            }

            if (! $child instanceof DOMElement) {
                continue;
            }

            $tag = strtolower($child->nodeName);

            if (Html::isDropped($tag)) {
                // Void elements cannot hold content; older libxml nests the
                // following content inside some of them.
                if (Html::isVoid($tag)) {
                    $this->walk($child, $pre);
                }

                continue;
            }

            if ($tag === 'br') {
                $this->lineBreak();

                continue;
            }

            $block = Html::isBlock($tag);

            if ($block) {
                $this->lineBreak();
            }

            $this->walk($child, $pre || $tag === 'pre');

            if ($block) {
                $this->lineBreak();
            }
        }
    }
}
