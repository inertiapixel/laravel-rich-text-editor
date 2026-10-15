# InertiaPixel Rich Text Editor for Laravel

A rich text, Markdown, plain-text and source editor for Laravel, delivered as a Blade component.

```blade
<x-inertiapixel::rich-text-editor name="content" />
```

- **Built from scratch.** The editor engine is vanilla JavaScript, HTML and CSS. It doesn't use CKEditor, TinyMCE, Quill, Tiptap, ProseMirror, Slate, Lexical, `document.execCommand()`, or any third-party JavaScript library.
- **No build step for your app.** Compiled assets ship with the package and are served automatically. You don't need npm, Vite or any JavaScript of your own.
- **Semantic output.** The editor saves headings, paragraphs, lists, links, tables and so on. Presentation is expressed with CSS classes, never `style` attributes.
- **Isolated.** It creates exactly one global (`window.InertiaPixelRichTextEditor`), and every CSS rule is scoped to the editor's own classes.

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Modes and stored formats](#modes-and-stored-formats)
- [Configuration](#configuration)
- [Toolbar and keyboard shortcuts](#toolbar-and-keyboard-shortcuts)
- [Images and file uploads](#images-and-file-uploads)
- [Tables](#tables)
- [Character limits and the counter](#character-limits-and-the-counter)
- [Validating and saving content](#validating-and-saving-content)
- [Rendering saved content safely](#rendering-saved-content-safely)
- [Styling](#styling)
- [Assets](#assets)
- [JavaScript API and events](#javascript-api-and-events)
- [Accessibility](#accessibility)
- [Security notes](#security-notes)
- [Known limitations](#known-limitations)
- [Development](#development)

## Requirements

| | Supported | Tested |
| --- | --- | --- |
| PHP | 8.2+ | 8.2.10, 8.3.0RC1, 8.4.18, 8.5.2 |
| Laravel | 12.x, 13.x | 12.70, 13.36 |
| PHP extensions | `dom`, `mbstring` (`fileinfo` for the optional upload endpoint) | |

**Laravel 11 isn't supported.** Every Laravel 11 release carries unpatched security advisories, and Composer refuses to install them by default, so I couldn't test against it.

**Browsers.** Automated tests run on Chromium 151, Firefox 153 and WebKit 26.5 (Playwright builds on macOS). The bundle targets Chrome/Edge 100+, Firefox 100+ and Safari 15.4+, but those older versions, mobile browsers and screen readers haven't been tested.

## Installation

```bash
composer require inertiapixel/laravel-rich-text-editor
```

That's all. The service provider is auto-discovered, the default configuration is built in, and the editor's CSS and JavaScript are served by the package. Publishing the configuration or assets is optional (see [Configuration](#configuration) and [Assets](#assets)).

## Usage

### Basic

```blade
<form method="POST" action="/articles">
    @csrf
    <label for="content">Content</label>
    <x-inertiapixel::rich-text-editor name="content" id="content" />
    <button type="submit">Save</button>
</form>
```

The editor submits the field `content`, plus a companion field `content_format` holding `html`, `markdown` or `text` (see [Modes](#modes-and-stored-formats)).

### Pre-filled value

```blade
<x-inertiapixel::rich-text-editor
    name="content"
    :value="old('content', $article->content ?? '')"
/>
```

After a failed validation, the component uses the old input automatically when there is some for the field, even if you pass only `:value="$article->content"`. Pass `:old-input="false"` to turn this off.

### Customized

```blade
<x-inertiapixel::rich-text-editor
    name="content"
    id="article-content"
    :value="old('content', '')"
    placeholder="Write your article..."
    mode="rich"
    min-height="400px"
    :min-chars="100"
    :max-chars="5000"
    :options="[
        'markdown' => true,
        'plainText' => true,
        'codeView' => true,
        'images' => true,
        'files' => true,
        'tables' => true,
    ]"
/>
```

### Component attributes

Blade converts kebab-case attributes to the component's camelCase properties. Use `:attr="..."` for PHP expressions.

| Attribute | Type | Description |
| --- | --- | --- |
| `name` | string, **required** | Form field name. Names like `post[body]` work; the format field becomes `post[body_format]`. |
| `id` | string | ID of the form field, so `<label for="...">` works. Generated from the name when omitted (`ipx-rte-content`, then `ipx-rte-content-2`, and so on). The editor root gets `{id}-editor`. |
| `value` | string | Initial content in the stored format. |
| `format` | `html` \| `markdown` \| `text` | Format of `value`. Defaults to the format of the initial mode. |
| `mode` | `rich` \| `markdown` \| `text` \| `code` | Initial mode. It must be enabled; otherwise the first enabled mode is used. |
| `placeholder` | string | Placeholder text. It is never part of the value. |
| `min-height`, `max-height` | CSS length or integer (px) | Height of the editing area, for example `400px` or `20rem`. |
| `readonly` | bool | Content is submitted but can't be changed. |
| `disabled` | bool | Not editable and not submitted (like a disabled field). |
| `required` | bool | Submission is blocked while the editor is empty. |
| `toolbar` | array or string | Overrides the toolbar, for example `toolbar="bold italic \| link"` or `:toolbar="['bold', 'link']"`. |
| `options` | array | Per-instance [configuration overrides](#configuration-precedence). |
| `upload-url` | string | Upload endpoint for this editor (absolute `http(s)` URL or a path starting with `/`). |
| `aria-label` | string | Accessible name when there is no `<label for>`. |
| `min-chars`, `max-chars` | int | Character limits. `0` is a real limit. |
| `show-counter` | bool | Force the counter on or off (by default it's shown when a limit is set). |
| `error-bag` | string | Validation error bag to read errors from (default `default`). |
| `old-input` | bool | Use old input after validation fails (default `true`). |
| `class`, others | | Merged onto the editor's root element (escaped by Blade). |

You can render any number of editors on one page. Each has its own state, history, dialogs and limits.

## Modes and stored formats

| Mode | Edits | Stored format | Enabled by default |
| --- | --- | --- | --- |
| Rich text (`rich`) | A WYSIWYG `contenteditable` surface | `html`: semantic HTML | yes |
| Markdown (`markdown`) | Markdown source, with an optional Preview | `markdown`: the Markdown source | no |
| Plain text (`text`) | A plain textarea | `text`: the text, line breaks kept | no |
| Source (`code`) | The source of the current format | unchanged | yes |

The mode switcher only shows enabled modes. The form field keeps its name in every mode; `content_format` tells your controller which format was submitted. If you enable more than one format, store the format alongside the content and pass it back with `format="..."`.

**What gets submitted**
- **HTML:** compact, sanitized semantic HTML. An empty document submits an empty string.
- **Markdown and text:** the source exactly as typed. Browsers submit line breaks as CRLF, and `RichTextLength` normalizes them when counting.
- **Source view of HTML:** the sanitized version of what you typed. A notice lists markup that will be removed, for example `<script>` or `style=""`.

### Switching rules

| Switch | What happens |
| --- | --- |
| Rich ↔ Source | No conversion. Source view shows the formatted HTML of the document. Leaving Source view asks for confirmation if unsupported markup would be removed. |
| Rich → Markdown | Converted. If something has no Markdown equivalent (underline, alignment, indentation, image sizes, styles and captions, table designs, tables without a header row, links that open in a new tab, attachment styling), a dialog lists it and **Cancel keeps everything unchanged**. |
| Markdown → Rich | Converted without loss for the [supported subset](#markdown-subset). |
| Rich or Markdown → Plain text | Formatting is removed. A dialog warns first. |
| Plain text → Rich or Markdown | Lossless: text stays text and is escaped where needed. |
| Switching back without editing | Restores the exact previous source (for example your original Markdown spacing and markers). |
| Undo | Reverts a mode switch, including any content lost in the conversion. |

Source view and a "code block" are different things: Source view is an editing mode, while a code block (`<pre><code>`) is part of the article.

### Markdown subset

Supported: paragraphs, ATX and setext headings, `*em*`/`_em_`, `**strong**`/`__strong__`, `~~strikethrough~~`, inline code, links (with titles), images, autolinks (`<https://…>`), backslash escapes, hard line breaks, bullet and ordered lists (nested, with start numbers), blockquotes, fenced and indented code blocks, thematic breaks and GFM pipe tables (when tables are enabled).

Not supported: raw HTML (always shown as text), reference-style links, footnotes, task lists, and HTML entities (shown literally). This isn't a full CommonMark implementation; emphasis follows CommonMark's delimiter rules. Converting HTML to Markdown escapes Markdown syntax in text so it survives a round trip.

## Configuration

Defaults are built in. To customize them globally, publish the config file:

```bash
php artisan vendor:publish --tag=inertiapixel-rich-text-editor-config
```

`config/richtext.php` only needs the keys you want to change; missing keys keep their defaults. See the [published file](config/richtext.php) for every option and its documentation. The main sections:

| Key | Purpose |
| --- | --- |
| `default_mode`, `mode_order`, `rich_text`, `markdown`, `plain_text`, `code_view` | Modes (`markdown.preview` toggles the Preview button). |
| `format_field` | Name of the format field. `null` derives it from the field name; `false` disables it. |
| `placeholder`, `min_height`, `max_height`, `theme` (`light`/`dark`/`auto`), `classes.root`, `classes.content` | Appearance. |
| `toolbar`, `headings`, `max_indent`, `shortcuts` | Toolbar, heading levels, indentation depth and keyboard shortcuts. |
| `links` | Link insertion, "open in a new tab", allowed protocols. |
| `images`, `files`, `uploads` | Image and attachment dialogs, allowlists, sizes, upload endpoint. |
| `tables` | Table presets, defaults and size limits. |
| `limits`, `counter` | Character limits, hard enforcement, submit validation, counter display. |
| `paste` | `semantic` or `text` paste; whether `data:` images are allowed. |
| `accessibility` | Default `aria-label` and limit announcements. |
| `assets` | Asset delivery (`route`, `published` or `manual`). |
| `unknown_options` | `throw` (default) or `ignore` unknown keys in `:options`. |

### Configuration precedence

```
built-in defaults  <  config/richtext.php  <  Blade :options  <  dedicated attributes (min-chars, toolbar, ...)
```

Merging follows the same rules at every level:

- **Sections merge key by key.** Overriding `images.max_size` keeps `images.enabled`, `images.allow_alt` and the rest.
- **Lists and maps are replaced as a whole.** Examples are `toolbar`, `allowed_formats`, `images.classes` and `tables.presets`. An explicit empty list means "none" (`'toolbar' => []` hides every toolbar item) and never restores the defaults. An empty *section* (`'images' => []`) changes nothing.
- **Explicit `false` and `0` are kept.** `null` clears a nullable value, such as `max_chars`.
- **Booleans can stand in for a section:** `'images' => false` means `['images' => ['enabled' => false]]`.
- **Keys can be camelCase or snake_case:** `plainText`, `codeView` and `allowedFormats` work in `:options`.
- **Unknown keys in `:options` throw** an `InvalidOptionException` naming the key, unless `unknown_options` is `ignore`. Unknown keys in the config file are ignored, so stale keys never break an app. Values are type-checked.
- **Server-only settings can't be overridden per instance.** These are `uploads.disk`, `uploads.directory`, `uploads.visibility`, `uploads.route.*`, `assets.*` and `unknown_options`.
- **Nothing is written back.** Resolving one instance never modifies Laravel's configuration or another instance's options.

```blade
{{-- Only this editor accepts fewer formats with a smaller limit. --}}
<x-inertiapixel::rich-text-editor
    name="content"
    :options="['images' => ['allowed_formats' => ['png', 'webp'], 'max_size' => 2]]"
/>
```

Only a client-safe subset of the resolved configuration is sent to the browser. Disk, directory, middleware, gate and asset settings never reach the page.

## Toolbar and keyboard shortcuts

Available toolbar items: `undo`, `redo`, `heading` (block style menu), `paragraph`, `bold`, `italic`, `underline`, `strikethrough`, `inline_code`, `bullet_list`, `ordered_list`, `outdent`, `indent`, `align_left`, `align_center`, `align_right`, `align_justify`, `link`, `unlink`, `blockquote`, `code_block`, `horizontal_rule`, `image`, `file`, `table`, `clear_formatting`, and `|` (group separator). Items whose feature is disabled are removed automatically.

A table toolbar appears while the caret is in a table. It has row above/below, delete row, column left/right, delete column, header row, design and delete table.

| Action | Shortcut ("Mod" is Cmd on macOS, Ctrl elsewhere) |
| --- | --- |
| Undo / redo | Mod+Z / Mod+Shift+Z (Ctrl+Y also redoes on Windows/Linux) |
| Bold, italic, underline | Mod+B, Mod+I, Mod+U |
| Strikethrough, inline code | Mod+Shift+X, Mod+E |
| Link | Mod+K |
| Paragraph, headings 1–6 | Mod+Alt+0, Mod+Alt+1 … 6 |
| Bulleted / numbered list, quote | Mod+Shift+8 / Mod+Shift+7, Mod+Shift+9 |
| Code block, clear formatting | Mod+Alt+C, Mod+\\ |
| Paste as plain text | Mod+Shift+V |
| Move to the toolbar / back | Alt+F10 / Escape |
| Indent / outdent a list item | Tab / Shift+Tab (in lists only) |
| Next / previous table cell | Tab / Shift+Tab (Tab in the last cell adds a row) |

Change or disable shortcuts with the `shortcuts` config (set one to `null` to disable it). Outside lists and tables, Tab moves focus as usual. Markdown mode has toolbar support for bold, italic, strikethrough, inline code, headings, lists, quotes, code blocks, rules, links, images, files and tables.

## Images and file uploads

The image button opens a dialog with these fields, each configurable under `images`:

- **Source:** upload a file and/or enter a URL.
- **Alternative text:** required unless the image is marked decorative, which saves `alt=""`.
- **Title and caption:** a caption makes a `<figure>`.
- **Style classes:** from an allowlist, plus validated custom classes if `allow_custom_classes` is on.
- **Width and height:** in `%` or `px`.
- **Alignment and display:** left, center or right; inline or block.

Double-click an image (or select it and press Enter) to edit it. Pasting or dropping an image file opens the dialog with the file selected, so alt text can still be added.

**Sizes never use `style` attributes:**
- Percentages are stored as classes: `ipx-rte-w-50` for width and `ipx-rte-h-50` for height. Supported values are multiples of 5 from 5 to 100, plus 33 and 66; `images.percent_steps` chooses which ones are offered.
- Pixels are stored as `width` and `height` attributes.
- Percentage heights only take effect when the image's container has a defined height, which is a CSS limitation.

**Alignment and display** use `ipx-rte-img-left`, `ipx-rte-img-center`, `ipx-rte-img-right` and `ipx-rte-img--block`.

**Style classes** come from `images.classes`, a map of `class => label`. The defaults are `ipx-rte-img--rounded`, `ipx-rte-img--bordered` and `ipx-rte-img--shadow`.

**Attachments** (`files.enabled`, off by default) are inserted as links, `<a class="ipx-rte-attachment" href="…">name</a>`. Files are never embedded.

### Upload endpoint

Uploads need an endpoint, and none is enabled by default. If uploads are enabled without one, the dialog says so instead of failing silently, and inserting by URL still works. You have two options.

**Option 1: your own endpoint.** Set `RICHTEXT_UPLOAD_URL=/editor/uploads` (or `uploads.url`, or `upload-url="..."` per editor), then implement this contract:

- **Request:** `POST multipart/form-data` with the file in `file` (configurable as `uploads.field`) and `type` set to `image` or `file`. It includes the headers `Accept: application/json`, `X-Requested-With` and `X-CSRF-TOKEN`.
- **Success:** any 2xx JSON response, for example `{"url": "https://…/a.png", "name": "a.png", "size": 1234, "mime": "image/png", "type": "image"}`. Only `url` is required, and it must be `http(s)` or relative. Anything else (such as `javascript:`) is rejected as an invalid response.
- **Failure:** a non-2xx JSON response such as `{"message": "...", "errors": {"file": ["..."]}}`. Laravel's validation responses already match this, and the first `errors.file` message (or `message`) is shown in the dialog.

```php
Route::post('/editor/uploads', function (Request $request) {
    $request->validate([
        'file' => ['required', 'file', 'max:5120', 'extensions:jpg,jpeg,png,webp', 'mimetypes:image/jpeg,image/png,image/webp'],
    ]);

    $file = $request->file('file');
    $path = $file->storeAs('editor', Str::random(40).'.'.strtolower($file->getClientOriginalExtension()), 'public');

    return response()->json(['url' => Storage::disk('public')->url($path), 'name' => $file->getClientOriginalName()], 201);
})->middleware(['web', 'auth']);
```

**Option 2: the built-in endpoint.** Opt in through config:

```php
'uploads' => [
    'disk' => 'public',
    'directory' => 'rich-text-editor',
    'route' => [
        'enabled' => true,
        'middleware' => ['web', 'auth'],
        'gate' => 'upload-editor-files', // optional Gate ability
    ],
],
```

It uses only the server's configuration and never accepts rules from the request or from editor options. It does the following:

- checks the gate
- validates size, the client extension and the real MIME type (via `fileinfo`), and checks that images are real images (`getimagesize`)
- stores files under random names on the configured disk
- returns the contract above

Run `php artisan storage:link` if you use the `public` disk.

**Never allowed.** Extensions and MIME types that can run code or script (PHP, executables, HTML, SVG, XML, JS and similar) are rejected even if you configure them.

**Client checks are only for usability.** Per-instance `:options` shape the dialog; they are not a security boundary. Your endpoint must enforce authentication, authorization, extension, real MIME type, size and storage rules itself.

## Tables

The table dialog sets rows, columns, an optional header row and design presets. Presets are classes on the table:

| Preset | Class |
| --- | --- |
| (always) | `ipx-rte-table` |
| Bordered | `ipx-rte-table--bordered` |
| Striped | `ipx-rte-table--striped` |
| Compact | `ipx-rte-table--compact` |
| Responsive (horizontal scroll) | `ipx-rte-table--responsive` |

Presets can be combined. Configure them with `tables.presets` (a map of `key => label`, which produces `ipx-rte-table--{key}`) and `tables.default_presets`. For a custom preset, add CSS such as `.ipx-rte-content .ipx-rte-table--brand { … }`.

Tables always keep a valid structure: an optional `<thead>` with `<th scope="col">` cells, a `<tbody>`, and the same number of cells in every row. Pasted tables are normalized: `colspan`/`rowspan` are expanded into separate cells, blocks inside cells are flattened, and styles are dropped. Table CSS is scoped to `.ipx-rte-content`, so other tables in your app aren't affected.

## Character limits and the counter

```blade
<x-inertiapixel::rich-text-editor name="content" :min-chars="100" :max-chars="5000" />
```

Defaults can live in `config/richtext.php` (`limits.min_chars`, `limits.max_chars`); attributes override them for one editor.

- **When the counter shows.** It appears automatically when a minimum or maximum is set, for example `245 / 5000 characters` or `12 characters (minimum 100)`. Use `show-counter` (or `counter.show`) to force it on or off, and `counter.words` to add a word count.
- **What it reacts to.** It updates on typing, paste, deletion, undo/redo and mode switches, and shows states for "minimum not met", "maximum reached" and "maximum exceeded".
- **Screen readers.** Crossing a limit is announced through a polite live region, once per change of state, never on every keystroke.
- **Submission.** By default (`limits.validate_on_submit`), the form doesn't submit while a limit isn't met, and the editor explains why. An empty, non-required field skips the minimum, just like the native `minlength`. `formnovalidate` buttons and `novalidate` forms are respected.
- **Hard limit.** Content is never truncated silently. With `limits.enforce_max` set to `true`, typing stops at the maximum and a paste that would exceed it is rejected with an announcement. IME composition is never interrupted: composed text that ends up over the limit stays, marked as over the limit. Hard enforcement doesn't apply in Source view of HTML.

**Counting contract.** The unit is Unicode code points, the same as PHP's `mb_strlen`. So `👍` counts as 1, `é` (precomposed) as 1, `é` written as `e` + a combining accent as 2, and a ZWJ family emoji as 5.

| Mode | What is counted |
| --- | --- |
| Rich text | Visible text only. Tags, attributes, URLs, alt text and the placeholder don't count. Runs of whitespace count as one space; line and paragraph breaks don't count; non-breaking spaces do. |
| Source view of HTML | The visible text of the HTML being edited, which is what will be saved. Tags aren't counted. |
| Markdown | The Markdown source, including syntax such as `**`. Line breaks count as 1. |
| Plain text | The text. Line breaks count as 1. |

The same rules are implemented in PHP (`VisibleText`, `RichTextLength`). Both are tested against one shared set of fixtures, so the browser and the server agree.

## Validating and saving content

Client-side checks are never a replacement for server-side validation. Laravel's `min`/`max` rules measure the whole string, so for HTML they count tags and attributes too:

```php
$request->validate([
    'content' => ['required', 'string', 'min:100', 'max:5000'], // counts markup as well
]);
```

When a business rule is about visible characters, use the package's rule. It counts exactly like the editor:

```php
use InertiaPixel\RichTextEditor\Rules\RichTextLength;

$validated = $request->validate([
    'content' => ['required', 'string', RichTextLength::between(100, 5000)->format($request->input('content_format'))],
    'content_format' => ['required', 'in:html,markdown,text'],
]);

$article->update([
    'content' => $validated['content'],
    'content_format' => $validated['content_format'],
]);
```

`RichTextLength::min(…)`, `::max(…)` and `::between(…)` are available. `format()` accepts `html` (the default), `markdown` or `text`; unknown values are measured as HTML. The rule is never registered globally. Validation errors for the field (for example `@error('content')`) appear under the editor automatically and are linked to it with `aria-invalid` and `aria-describedby`. Old input, including the format, is restored after a redirect.

## Rendering saved content safely

**Treat saved HTML as untrusted.** Anyone can post arbitrary HTML to your endpoint, bypassing the editor. Sanitize on the server before rendering:

```blade
<x-inertiapixel::rich-text-content :content="$article->content" :format="$article->content_format" class="prose" />
```

This renders inside `<div class="ipx-rte-content">` and includes the content stylesheet once per page.

- **`html`** goes through `HtmlSanitizer`, an allowlist of the editor's elements, attributes, URL protocols and classes.
- **`markdown`** goes through Laravel's `Str::markdown()` with raw HTML escaped and unsafe links removed, and is then sanitized.
- **`text`** is escaped and split into paragraphs.

You can also call the sanitizer directly: `InertiaPixel\RichTextEditor\Support\HtmlSanitizer::clean($html)`.

The sanitizer is conservative and well tested, but it hasn't been independently security-audited. For content from untrusted users, consider adding a dedicated, audited HTML sanitizer as well. Never render saved HTML with `{!! !!}` without sanitizing it.

## Styling

The stylesheets use only classes under `.ipx-rte` (editor UI), `.ipx-rte-dialog` (modals) and `.ipx-rte-content` (content). There are no global resets and no element selectors outside those roots.

Customize with CSS variables on the root (or any ancestor):

```css
.ipx-rte, .ipx-rte-dialog {
    --ipx-rte-accent: #7c3aed;
    --ipx-rte-radius: 10px;
    --ipx-rte-border: #e5e7eb;
    --ipx-rte-ui-font: "Inter", sans-serif;
}
.ipx-rte-content {
    --ipx-rte-content-link: #7c3aed;
    --ipx-rte-content-line-height: 1.7;
}
```

**Editor variables:** `--ipx-rte-font`, `--ipx-rte-ui-font`, `--ipx-rte-font-size`, `--ipx-rte-text`, `--ipx-rte-muted`, `--ipx-rte-bg`, `--ipx-rte-toolbar-bg`, `--ipx-rte-border`, `--ipx-rte-border-strong`, `--ipx-rte-hover`, `--ipx-rte-active`, `--ipx-rte-accent`, `--ipx-rte-accent-text`, `--ipx-rte-focus`, `--ipx-rte-danger`, `--ipx-rte-warning`, `--ipx-rte-notice-bg`, `--ipx-rte-radius`, `--ipx-rte-button-size`, `--ipx-rte-code-font`, `--ipx-rte-min-height`, `--ipx-rte-max-height`.

**Content variables:** `--ipx-rte-content-text`, `--ipx-rte-content-muted`, `--ipx-rte-content-link`, `--ipx-rte-content-border`, `--ipx-rte-content-code-bg`, `--ipx-rte-content-code-text`, `--ipx-rte-content-quote-border`, `--ipx-rte-content-table-head-bg`, `--ipx-rte-content-table-stripe`, `--ipx-rte-content-attachment-bg`, `--ipx-rte-content-line-height`, `--ipx-rte-content-spacing`, `--ipx-rte-content-code-font`, `--ipx-rte-content-indent`.

`theme` can be `light`, `dark` or `auto` (follows `prefers-color-scheme`). Use `classes.root` and `classes.content` (or a `class` attribute) to add your own classes, for example `prose` on the editing surface.

Content classes:
- **Text alignment:** `ipx-rte-text-left`, `-center`, `-right` and `-justify`.
- **Indentation:** `ipx-rte-indent-1` … `-8`.
- **Image classes:** described [above](#images-and-file-uploads).

## Assets

By default, the first editor on a page outputs:

```html
<link rel="stylesheet" href="/inertiapixel/rich-text-editor/assets/editor.css?v=…">
<script src="/inertiapixel/rich-text-editor/assets/editor.js?v=…" defer></script>
```

These are served by a package route without sessions or cookies. Versioned URLs are cached as `immutable`, and conditional requests are supported. If Vite has a CSP nonce (`Vite::useCspNonce()`), it's added to both tags. The script is a strict-mode IIFE and reads its configuration from a `data-` attribute, so no inline script is needed.

| `assets.mode` | Behaviour |
| --- | --- |
| `route` (default) | Served by the package route. |
| `published` | Uses files copied by `php artisan vendor:publish --tag=inertiapixel-rich-text-editor-assets` (into `public/vendor/inertiapixel/rich-text-editor`), or `assets.url` for a CDN. Re-publish with `--force` after updating the package. |
| `manual` | Outputs nothing; include the assets yourself. |

Directives:
- `@inertiapixelRichTextEditorAssets` outputs the editor tags in `<head>`; editors on the page then don't repeat them.
- `@inertiapixelRichTextContentStyles` outputs only the content stylesheet, for pages that display saved content.

Set `assets.auto_inject` to `false` to rely on the directives only.

You can also publish the views (`--tag=inertiapixel-rich-text-editor-views`) and translations (`--tag=inertiapixel-rich-text-editor-lang`). UI strings come from `resources/lang/en/editor.php` and follow `app()->getLocale()`.

## JavaScript API and events

You don't need any JavaScript to use the editor. Editors initialize on page load, and editors added later (Livewire, Turbo, dynamic forms) are picked up automatically. Editors whose markup is removed are destroyed, along with their dialogs and listeners. The only global is `window.InertiaPixelRichTextEditor`, and loading the script twice is harmless.

```js
const api = window.InertiaPixelRichTextEditor;

api.init(element);               // initialize editors inside an element (idempotent)
const editor = api.get('#content'); // by field id, root element or selector
api.destroy('#content');
api.instances();

editor.getValue();               // stored value in the current format
editor.getFormat();              // "html" | "markdown" | "text"
editor.getMode();                // "rich" | "markdown" | "text" | "code"
await editor.setMode('markdown', { confirm: false }); // skip the loss dialog
editor.setValue('<p>Hello</p>', 'html');
editor.getCharacterCount();
editor.focus();

// Pure helpers
api.utils.markdownToHtml('**hi**');
api.utils.htmlToMarkdown('<p><em>hi</em></p>');
api.utils.sanitizeHtml(html);
api.utils.countCharacters(html);
```

Events bubble from the editor root:

| Event | `event.detail` |
| --- | --- |
| `ipx-rte:ready` | `editor` |
| `ipx-rte:change` | `editor`, `value`, `format`, `mode` |
| `ipx-rte:mode-change` | `editor`, `mode`, `format`, `previousMode` |
| `ipx-rte:upload-error` | `editor`, `message`, `type` |
| `ipx-rte:destroy` | `editor` |

The underlying `<textarea>` also receives `input` events whenever the value changes. With Livewire, wrap the editor in an element with `wire:ignore` and read the value from the field or the `ipx-rte:change` event. The editor doesn't depend on jQuery, Alpine, Livewire, Vue or React, and doesn't modify them.

## Accessibility

- The editing surface is `role="textbox"` with `aria-multiline`, named by your `<label for="id">` (clicking the label focuses the editor) or by `aria-label`. The counter and error messages are linked with `aria-describedby`; `aria-required`, `aria-readonly` and `aria-invalid` reflect the state.
- The toolbar is `role="toolbar"` with a roving tabindex: Tab enters it once and the arrow keys move inside it. Toggle buttons expose `aria-pressed` and `aria-keyshortcuts`.
- Dialogs use the native `<dialog>` element as labelled modals. Escape closes them and focus returns to the editor. Field errors use `aria-invalid` and are linked descriptions.
- Image alt text is required by default, with an explicit "decorative" option.
- Without JavaScript, the field remains a plain, working `<textarea>`.

## Security notes

- **Output is rebuilt from an allowlist.** Pasted, dropped, loaded and source-edited HTML is parsed into an inert document (scripts never run) and rebuilt. Scripts, event handlers, styles, embedded content, `javascript:`/`data:`/`vbscript:` URLs and unknown classes are removed; `target="_blank"` links get `rel="noopener noreferrer"`. The browser-side boundary is for usability and the server must sanitize again (see [above](#rendering-saved-content-safely)).
- **Upload checks in the browser are only for usability**, and per-instance options are never a security boundary.
- **The CSRF token** is included in the editor configuration only when uploads are possible.

## Known limitations

- **Markdown:** a [documented subset](#markdown-subset), not full CommonMark. Laravel's `Str::markdown()` treats a line that starts with an HTML tag as an HTML block (escaped as a whole), while the editor's preview treats it as a paragraph. Both are safe; the rendering differs.
- **Inline-only list items and table cells.** List items hold inline content plus nested lists; extra paragraphs inside an item become line breaks, and code blocks or quotes inside items are flattened. Table cells hold inline content, and merged cells are expanded on import.
- **Undo history** lives in the page (up to 100 steps) and isn't kept across page loads.
- **IME and hard limits:** hard `max_chars` enforcement never interrupts IME composition and isn't applied in Source view of HTML.
- **Pasting files:** pasted or dropped image files need an upload endpoint, and `data:` images are dropped unless `paste.allow_data_images` is enabled.
- **Responsive tables:** the preset uses `display: block`, which some screen readers handle less well than a normal table.
- **Layout parity:** native contenteditable behaviour (spell check, autocorrect, caret movement) differs between browsers. The editor normalizes the saved HTML, but layout details while editing can differ.
- **Untested environments:** only the browsers listed under [Requirements](#requirements) are tested automatically. Mobile browsers and assistive technologies haven't been tested.

## Development

The compiled files in `resources/dist` are committed and shipped. Rebuild them after changing `resources/js` or `resources/css`. Node and npm are needed only for development.

```bash
composer install
npm install
npm run build          # bundle resources/js + resources/css into resources/dist (esbuild)
vendor/bin/phpunit     # PHP tests (Orchestra Testbench)
npx playwright install chromium firefox webkit
npm test               # browser tests (Playwright; pages are rendered by the real Blade component)
```

To install the package into a fresh Laravel app exactly as Composer would from Packagist, and run the end-to-end test against it:

```bash
tests/integration/create-app.sh /tmp/ipx-app "^13.0" php
(cd /tmp/ipx-app && php artisan serve --port=8765) &
IPX_APP_URL=http://127.0.0.1:8765 npx playwright test tests/browser/integration.spec.js
```

## License

MIT. See [LICENSE](LICENSE).
