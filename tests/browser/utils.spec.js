/**
 * Pure logic (Markdown, sanitizer, counting, conversions) exercised through
 * the public utils API in a real browser.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { open, page as wrap } from './helpers.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/visible-text.json', import.meta.url), 'utf8'));

const POLICY = {
    headings: [1, 2, 3, 4, 5, 6],
    images: { enabled: true, classes: { 'ipx-rte-img--rounded': 'Rounded' }, percentSteps: [25, 50, 100] },
    tables: { enabled: true, presets: { bordered: 'Bordered', striped: 'Striped' } },
    files: { enabled: true },
};

test.beforeEach(async ({ page }) => {
    await open(page, wrap('<script src="/inertiapixel/rich-text-editor/assets/editor.js"></script>'));
});

const md = (page, markdown, config = POLICY) => page.evaluate(([value, policy]) => window.InertiaPixelRichTextEditor.utils.markdownToHtml(value, policy, { pretty: false }), [markdown, config]);
const toMd = (page, html, config = POLICY) => page.evaluate(([value, policy]) => window.InertiaPixelRichTextEditor.utils.htmlToMarkdown(value, policy), [html, config]);
const clean = (page, html, config = POLICY, options = {}) => page.evaluate(([value, policy, opts]) => window.InertiaPixelRichTextEditor.utils.sanitizeHtml(value, policy, { pretty: false, ...opts }), [html, config, options]);
const convert = (page, from, to, value, config = POLICY) => page.evaluate(([a, b, v, policy]) => window.InertiaPixelRichTextEditor.utils.convert(a, b, v, policy), [from, to, value, config]);

test.describe('Markdown to HTML', () => {
    const cases = [
        ['paragraphs and soft breaks', 'one\ntwo\n\nthree', '<p>one two</p><p>three</p>'],
        ['ATX headings', '# One\n## Two ##\n###### Six', '<h1>One</h1><h2>Two</h2><h6>Six</h6>'],
        ['setext headings', 'Title\n=====\n\nSub\n---', '<h1>Title</h1><h2>Sub</h2>'],
        ['emphasis and strong', '*a* _b_ **c** __d__ ***e***', '<p><em>a</em> <em>b</em> <strong>c</strong> <strong>d</strong> <em><strong>e</strong></em></p>'],
        ['intraword emphasis', 'a*b*c snake_case_word', '<p>a<em>b</em>c snake_case_word</p>'],
        ['strikethrough', '~~gone~~ ~single~', '<p><s>gone</s> ~single~</p>'],
        ['inline code with backticks', '`` a`b `` and `x`', '<p><code>a`b</code> and <code>x</code></p>'],
        ['code span keeps markup literal', '`<b>*x*</b>`', '<p><code>&lt;b&gt;*x*&lt;/b&gt;</code></p>'],
        ['links with titles', '[Site](https://example.com "Home")', '<p><a href="https://example.com" title="Home">Site</a></p>'],
        ['link with parentheses in URL', '[w](https://en.wikipedia.org/wiki/A_(B))', '<p><a href="https://en.wikipedia.org/wiki/A_(B)">w</a></p>'],
        ['autolinks', '<https://example.com/x> <me@example.com>', '<p><a href="https://example.com/x">https://example.com/x</a> <a href="mailto:me@example.com">me@example.com</a></p>'],
        ['images', '![A cat](/cat.png "Cat")', '<p><img src="/cat.png" alt="A cat" title="Cat"></p>'],
        ['bullet list', '- a\n- b\n* c', '<ul><li>a</li><li>b</li></ul><ul><li>c</li></ul>'],
        ['ordered list with start', '3. a\n4. b', '<ol start="3"><li>a</li><li>b</li></ol>'],
        ['nested lists', '- a\n  - b\n    1. c\n- d', '<ul><li>a<ul><li>b<ol><li>c</li></ol></li></ul></li><li>d</li></ul>'],
        ['blockquote', '> quote\n> **bold**\n\n> second', '<blockquote><p>quote <strong>bold</strong></p></blockquote><blockquote><p>second</p></blockquote>'],
        ['lazy blockquote continuation', '> a\nb', '<blockquote><p>a b</p></blockquote>'],
        ['fenced code with language', '```php\necho "<b>";\n```', '<pre><code class="language-php">echo "&lt;b&gt;";</code></pre>'],
        ['tilde fence containing backticks', '~~~\n```\n~~~', '<pre><code>```</code></pre>'],
        ['indented code', '    code line\n    second', '<pre><code>code line\nsecond</code></pre>'],
        ['thematic breaks', '***\n\n- - -\n\n___', '<hr><hr><hr>'],
        ['GFM table with alignment', '| A | B | C |\n|:--|:-:|--:|\n| 1 | 2 | 3 |', '<table class="ipx-rte-table"><thead><tr><th scope="col" class="ipx-rte-text-left">A</th><th scope="col" class="ipx-rte-text-center">B</th><th scope="col" class="ipx-rte-text-right">C</th></tr></thead><tbody><tr><td class="ipx-rte-text-left">1</td><td class="ipx-rte-text-center">2</td><td class="ipx-rte-text-right">3</td></tr></tbody></table>'],
        ['escaped pipe in table', '| A |\n|---|\n| a \\| b |', '<table class="ipx-rte-table"><thead><tr><th scope="col">A</th></tr></thead><tbody><tr><td>a | b</td></tr></tbody></table>'],
        ['backslash escapes', '\\*not em\\* \\# \\[x\\]', '<p>*not em* # [x]</p>'],
        ['hard breaks', 'a  \nb\\\nc', '<p>a<br>b<br>c</p>'],
        ['raw HTML is text', '<b>bold</b> <script>alert(1)</script>', '<p>&lt;b&gt;bold&lt;/b&gt; &lt;script&gt;alert(1)&lt;/script&gt;</p>'],
        ['unclosed emphasis stays literal', '**open and *half', '<p>**open and *half</p>'],
    ];

    for (const [name, input, expected] of cases) {
        test(name, async ({ page }) => {
            expect(await md(page, input)).toBe(expected);
        });
    }

    test('dangerous link and image URLs are removed', async ({ page }) => {
        expect(await md(page, '[x](javascript:alert(1)) ![y](javascript:alert(2)) [z](data:text/html,hi)')).toBe('<p>x z</p>');
    });

    test('tables are plain text when tables are disabled', async ({ page }) => {
        expect(await md(page, '| A |\n|---|\n| 1 |', { tables: { enabled: false } })).toBe('<p>| A | |---| | 1 |</p>');
    });

    test('is deterministic', async ({ page }) => {
        const source = '# T\n\n- a\n- *b*\n\n> q\n\n```\nx\n```';

        expect(await md(page, source)).toBe(await md(page, source));
    });
});

test.describe('HTML to Markdown', () => {
    test('serializes the supported subset', async ({ page }) => {
        const html = '<h2>Title</h2><p>a <strong>b</strong> <em>c</em> <s>d</s> <code>e</code> <a href="https://x.test" title="T">f</a></p><ul><li>one<ul><li>two</li></ul></li></ul><ol start="2"><li>x</li></ol><blockquote><p>q</p></blockquote><pre><code class="language-js">let a = `b`;</code></pre><hr><p><img src="/i.png" alt="I"></p>';
        const expected = [
            '## Title',
            '',
            'a **b** *c* ~~d~~ `e` [f](https://x.test "T")',
            '',
            '- one',
            '  - two',
            '',
            '2. x',
            '',
            '> q',
            '',
            '```js',
            'let a = `b`;',
            '```',
            '',
            '---',
            '',
            '![I](/i.png)',
        ].join('\n');

        expect(await toMd(page, html)).toBe(expected);
    });

    test('escapes Markdown syntax in text and round-trips it', async ({ page }) => {
        const html = '<p>1. not a list *star* [x] _u_ `t` # h</p><p>- dash</p><p>&lt;b&gt; &amp;copy;</p>';
        const markdown = await toMd(page, html);

        expect(markdown).toBe('1\\. not a list \\*star\\* \\[x\\] \\_u\\_ \\`t\\` # h\n\n\\- dash\n\n\\<b> \\&copy;');
        expect(await md(page, markdown)).toBe(await clean(page, html));
    });

    test('keeps whitespace outside emphasis delimiters', async ({ page }) => {
        expect(await toMd(page, '<p>a<strong> b </strong>c</p>')).toBe('a **b** c');
    });

    test('serializes tables', async ({ page }) => {
        const html = '<table class="ipx-rte-table"><thead><tr><th>A</th><th class="ipx-rte-text-right">B</th></tr></thead><tbody><tr><td>1 | 2</td><td>3</td></tr></tbody></table>';

        expect(await toMd(page, html)).toBe('| A | B |\n| --- | ---: |\n| 1 \\| 2 | 3 |');
    });

    test('round-trips a representative document without loss', async ({ page }) => {
        const html = '<h1>T</h1><p>Text with <strong>bold <em>both</em></strong> and <a href="/x">link</a>.</p><ol><li>a<ul><li>b</li></ul></li><li>c</li></ol><blockquote><p>q</p><ul><li>l</li></ul></blockquote><pre><code>x\n\n  y</code></pre><table class="ipx-rte-table"><thead><tr><th scope="col">h</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table>';
        const result = await convert(page, 'html', 'markdown', html);

        expect(result.lossy).toBe(false);
        expect(await md(page, result.value)).toBe(await clean(page, html));
    });
});

test.describe('Sanitizer', () => {
    const cases = [
        ['removes scripts and their content', '<p>a</p><script>alert(1)</script><style>p{color:red}</style>', '<p>a</p>'],
        ['removes event handlers and styles', '<p style="color:red" onclick="alert(1)" onmouseover="x">a</p>', '<p>a</p>'],
        ['removes javascript: links', '<p><a href="javascript:alert(1)">x</a></p>', '<p>x</p>'],
        ['removes obfuscated javascript: links', '<p><a href="  JaVa&#x09;Script&colon;alert(1)">x</a><a href="jav&#x0A;ascript:alert(1)">y</a></p>', '<p>xy</p>'],
        ['removes vbscript and data links', '<p><a href="vbscript:msgbox(1)">a</a><a href="data:text/html;base64,PHNjcmlwdD4=">b</a></p>', '<p>ab</p>'],
        ['removes image error handlers', '<p><img src="/x.png" onerror="alert(1)" alt="x"></p>', '<p><img src="/x.png" alt="x"></p>'],
        ['drops images with script URLs', '<p>a<img src="javascript:alert(1)">b</p>', '<p>ab</p>'],
        ['drops data: images by default', '<p><img src="data:image/png;base64,AAAA" alt="d"></p>', ''],
        ['drops embedded content', '<iframe src="https://evil.test"></iframe><object data="x"></object><embed src="x"><svg onload="alert(1)"><circle /></svg><math><mi>x</mi></math><p>ok</p>', '<p>ok</p>'],
        ['drops form controls', '<form action="/x"><input name="a" value="v"><button>Go</button><textarea>t</textarea><select><option>o</option></select></form><p>ok</p>', '<p>ok</p>'],
        ['keeps safe link attributes and forces rel', '<p><a href="https://x.test" target="_blank" rel="opener" title="T" class="x" id="y">x</a></p>', '<p><a href="https://x.test" title="T" target="_blank" rel="noopener noreferrer">x</a></p>'],
        ['allows mailto, tel and relative links', '<p><a href="mailto:a@b.c">m</a><a href="tel:+1">t</a><a href="/p?q=1#h">r</a><a href="#top">h</a></p>', '<p><a href="mailto:a@b.c">m</a><a href="tel:+1">t</a><a href="/p?q=1#h">r</a><a href="#top">h</a></p>'],
        ['unwraps unknown elements', '<p><span class="x" data-y="z">a</span><font color="red">b</font><mark>c</mark></p>', '<p>abc</p>'],
        ['normalizes presentational tags', '<p><b>a</b><i>b</i><strike>c</strike><del>d</del><ins>e</ins></p>', '<p><strong>a</strong><em>b</em><s>cd</s><u>e</u></p>'],
        ['flattens nested identical marks', '<p><strong><b>x</b></strong></p>', '<p><strong>x</strong></p>'],
        ['turns divs into paragraphs', '<div>a</div><div><div>b</div><p>c</p></div>', '<p>a</p><p>b</p><p>c</p>'],
        ['wraps loose inline content', 'text <strong>bold</strong>', '<p>text <strong>bold</strong></p>'],
        ['keeps only allowed classes', '<p class="evil ipx-rte-text-center ipx-rte-indent-2">a</p><img class="ipx-rte-w-50 ipx-rte-img--rounded hacker" src="/a.png" alt="">', '<p class="ipx-rte-text-center ipx-rte-indent-2">a</p><p><img src="/a.png" alt="" class="ipx-rte-w-50 ipx-rte-img--rounded"></p>'],
        ['converts legacy align attributes to classes', '<p align="right">a</p>', '<p class="ipx-rte-text-right">a</p>'],
        ['keeps pixel dimensions as attributes', '<p><img src="/a.png" width="300" height="200px" style="width:300px"></p>', '<p><img src="/a.png" alt="" width="300"></p>'],
        ['keeps tables valid and expands spans', '<table class="ipx-rte-table--striped evil"><tr><td colspan="2">a</td></tr><tr><td>b</td><td>c</td><td>d</td></tr></table>', '<table class="ipx-rte-table ipx-rte-table--striped"><tbody><tr><td>a</td><td></td><td></td></tr><tr><td>b</td><td>c</td><td>d</td></tr></tbody></table>'],
        ['flattens blocks inside table cells', '<table><thead><tr><th><p>h1</p><p>h2</p></th></tr></thead><tbody><tr><td><ul><li>x</li></ul></td></tr></tbody></table>', '<table class="ipx-rte-table"><thead><tr><th scope="col">h1<br>h2</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>'],
        ['repairs lists', '<ul><li>a</li><ul><li>b</li></ul>c</ul>', '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>'],
        ['flattens paragraphs inside list items', '<ol><li><p>a</p><p>b</p></li></ol>', '<ol><li>a<br>b</li></ol>'],
        ['keeps code blocks as text', '<pre><code class="language-html hljs">&lt;b&gt;<span class="k">x</span>\n  y</code></pre>', '<pre><code class="language-html">&lt;b&gt;x\n  y</code></pre>'],
        ['collapses whitespace like rendered HTML', '<p>\n   a   <strong> b </strong>\n c  </p>', '<p>a <strong>b </strong>c</p>'],
        ['keeps non-breaking spaces', '<p>a&nbsp;&nbsp;b</p>', '<p>a&nbsp;&nbsp;b</p>'],
        ['keeps figures with captions', '<figure class="ipx-rte-figure ipx-rte-img-center"><img src="/a.png" alt="A" class="ipx-rte-img--rounded"><figcaption>Cap <em>tion</em></figcaption></figure>', '<figure class="ipx-rte-figure ipx-rte-img-center"><img src="/a.png" alt="A" class="ipx-rte-img--rounded"><figcaption>Cap <em>tion</em></figcaption></figure>'],
        ['keeps attachments', '<p><a class="ipx-rte-attachment" href="/files/a.pdf" download>a.pdf</a></p>', '<p><a href="/files/a.pdf" class="ipx-rte-attachment">a.pdf</a></p>'],
        ['drops empty paragraphs at the edges', '<p></p><p> </p><p>a</p><p><br></p>', '<p>a</p>'],
    ];

    for (const [name, input, expected] of cases) {
        test(name, async ({ page }) => {
            expect(await clean(page, input)).toBe(expected);
        });
    }

    test('maps disallowed heading levels to the nearest allowed level', async ({ page }) => {
        expect(await clean(page, '<h1>a</h1><h6>b</h6>', { headings: [2, 3] })).toBe('<h2>a</h2><h3>b</h3>');
    });

    test('allows data: images only when configured', async ({ page }) => {
        const html = '<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="d"></p>';

        expect(await clean(page, html, { paste: { allowDataImages: true } })).toBe('<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="d"></p>');
    });

    test('maps pasted office styles to semantic tags without keeping styles', async ({ page }) => {
        const html = '<b style="font-weight:normal" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700;color:red">Bold</span> <span style="font-style:italic">it</span> <span style="text-decoration:underline">u</span></p></b><p class="MsoNormal" style="mso-line-height:1">Word<o:p></o:p></p>';

        expect(await clean(page, html, POLICY, { mapStyles: true })).toBe('<p><strong>Bold</strong> <em>it</em> <u>u</u></p><p>Word</p>');
    });

    test('never outputs inline styles or event handlers', async ({ page }) => {
        const inputs = [
            '<p style="x">a</p>',
            '<div style="text-align:center"><span style="font-size:20px">b</span></div>',
            '<table style="width:100%"><tr><td style="background:red" onclick="x">c</td></tr></table>',
            '<img src="/a.png" style="width:50%" onload="x">',
            '<ul style="x"><li style="y" onfocus="z">d</li></ul>',
        ];

        for (const input of inputs) {
            const output = await clean(page, input, POLICY, { mapStyles: true });

            expect(output).not.toMatch(/\sstyle=/i);
            expect(output).not.toMatch(/\son[a-z]+=/i);
        }
    });

    test('parsing untrusted HTML never executes it', async ({ page }) => {
        await clean(page, '<img src="x" onerror="window.__ipxPwned = 1"><svg><script>window.__ipxPwned = 2</script></svg><iframe srcdoc="<script>parent.__ipxPwned=3</script>"></iframe>');
        await page.waitForTimeout(200);

        expect(await page.evaluate(() => window.__ipxPwned)).toBeUndefined();
    });
});

test.describe('Visible text and counting (shared fixtures with PHP)', () => {
    for (const fixture of fixtures) {
        test(fixture.name, async ({ page }) => {
            const result = await page.evaluate((html) => ({
                text: window.InertiaPixelRichTextEditor.utils.extractText(html),
                count: window.InertiaPixelRichTextEditor.utils.countCharacters(html),
            }), fixture.html);

            expect(result.text).toBe(fixture.text);
            expect(result.count).toBe(fixture.count);
        });
    }
});

test.describe('Format conversion rules', () => {
    test('HTML to Markdown reports loss for features Markdown cannot hold', async ({ page }) => {
        const result = await convert(page, 'html', 'markdown', '<p class="ipx-rte-text-center"><u>under</u></p><p><img src="/a.png" alt="" width="20"></p><table class="ipx-rte-table ipx-rte-table--bordered"><tbody><tr><td>x</td></tr></tbody></table><p><a href="/x" target="_blank" rel="noopener noreferrer">l</a></p>');

        expect(result.lossy).toBe(true);
        expect(result.reasons).toEqual(expect.arrayContaining(['loss_underline', 'loss_alignment', 'loss_image_options', 'loss_table_design', 'loss_table_structure', 'loss_link_target']));
    });

    test('Markdown to HTML is lossless for the subset', async ({ page }) => {
        const result = await convert(page, 'markdown', 'html', '# T\n\n*a* **b** ~~c~~ `d`\n\n- e\n\n> f');

        expect(result.lossy).toBe(false);
        expect(result.value).toContain('<h1>T</h1>');
    });

    test('HTML to plain text reports lost formatting', async ({ page }) => {
        const result = await convert(page, 'html', 'text', '<h2>Title</h2><p>Some <strong>bold</strong></p><ul><li>a</li><li>b</li></ul>');

        expect(result.lossy).toBe(true);
        expect(result.reasons).toEqual(['loss_formatting']);
        expect(result.value).toBe('Title\n\nSome bold\n\n- a\n- b');
    });

    test('plain paragraphs convert to plain text without loss', async ({ page }) => {
        const result = await convert(page, 'html', 'text', '<p>one<br>two</p><p>three</p>');

        expect(result).toEqual({ value: 'one\ntwo\n\nthree', lossy: false, reasons: [] });
    });

    test('plain text never becomes markup', async ({ page }) => {
        const result = await convert(page, 'text', 'html', '<script>alert(1)</script>\n<b>x</b>  two  spaces\n\nnext');

        expect(result.lossy).toBe(false);
        expect(result.value).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;<br>&lt;b&gt;x&lt;/b&gt; &nbsp;two &nbsp;spaces</p>\n<p>next</p>');
    });

    test('plain text to Markdown escapes syntax so the text survives', async ({ page }) => {
        const text = '*not bold* # not heading\n1. not a list';
        const toMarkdown = await convert(page, 'text', 'markdown', text);
        const back = await convert(page, 'markdown', 'text', toMarkdown.value);

        expect(toMarkdown.lossy).toBe(false);
        expect(back.value).toBe(text);
    });

    test('Markdown to plain text reports formatting loss', async ({ page }) => {
        const result = await convert(page, 'markdown', 'text', '**bold** [link](/x)');

        expect(result.lossy).toBe(true);
        expect(result.value).toBe('bold link');
    });
});
