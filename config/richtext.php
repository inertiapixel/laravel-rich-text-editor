<?php

/*
|--------------------------------------------------------------------------
| InertiaPixel Rich Text Editor
|--------------------------------------------------------------------------
|
| Every value below is a built-in default. Publishing this file is optional:
|
|     php artisan vendor:publish --tag=inertiapixel-rich-text-editor-config
|
| Values in a published file are merged recursively with these defaults, so
| a published file only needs the keys you want to change. Per-instance
| Blade `:options` are merged on top of the effective configuration.
|
| Merge rules: nested sections merge key by key; lists (toolbar items,
| allowed formats, ...) and maps (class labels, table presets, ...) are
| replaced as a whole, so an empty list intentionally means "none".
|
*/

return [

    /*
    |--------------------------------------------------------------------------
    | Modes
    |--------------------------------------------------------------------------
    |
    | "rich" edits semantic HTML, "markdown" edits Markdown source, "text"
    | edits plain text and "code" shows the source of the current format.
    | Only enabled modes are offered in the mode switcher.
    |
    */

    'default_mode' => 'rich',

    'mode_order' => ['rich', 'markdown', 'text', 'code'],

    'rich_text' => [
        'enabled' => true,
    ],

    'markdown' => [
        'enabled' => false,
        'preview' => true,
    ],

    'plain_text' => [
        'enabled' => false,
    ],

    'code_view' => [
        'enabled' => true,
    ],

    // Name of the companion field that submits the stored format
    // ("html", "markdown" or "text"). null derives it from the field name
    // ("content" => "content_format"); false disables the field.
    'format_field' => null,

    /*
    |--------------------------------------------------------------------------
    | Appearance
    |--------------------------------------------------------------------------
    */

    'placeholder' => null,

    'min_height' => '240px',

    'max_height' => null,

    // "light", "dark" or "auto" (follows prefers-color-scheme).
    'theme' => 'light',

    // Extra classes added to the editor root and to the editable surface.
    'classes' => [
        'root' => '',
        'content' => '',
    ],

    /*
    |--------------------------------------------------------------------------
    | Toolbar
    |--------------------------------------------------------------------------
    |
    | Available items: undo, redo, paragraph, heading, bold, italic,
    | underline, strikethrough, inline_code, bullet_list, ordered_list,
    | outdent, indent, align_left, align_center, align_right, align_justify,
    | link, unlink, blockquote, code_block, horizontal_rule, image, file,
    | table, clear_formatting. Use "|" as a group separator.
    |
    | Items whose feature is disabled (for example "image" when images are
    | disabled) are omitted automatically.
    |
    */

    'toolbar' => [
        'undo', 'redo', '|',
        'heading', '|',
        'bold', 'italic', 'underline', 'strikethrough', 'inline_code', '|',
        'bullet_list', 'ordered_list', 'outdent', 'indent', '|',
        'align_left', 'align_center', 'align_right', 'align_justify', '|',
        'link', 'unlink', 'blockquote', 'code_block', 'horizontal_rule', '|',
        'image', 'file', 'table', '|',
        'clear_formatting',
    ],

    // Heading levels offered in the block format menu (1-6).
    'headings' => [1, 2, 3, 4],

    // Maximum indentation level for paragraphs and headings.
    'max_indent' => 4,

    /*
    |--------------------------------------------------------------------------
    | Keyboard shortcuts
    |--------------------------------------------------------------------------
    |
    | "Mod" is Cmd on macOS and Ctrl elsewhere. Set a shortcut to null to
    | disable it.
    |
    */

    'shortcuts' => [
        'undo' => 'Mod+Z',
        'redo' => 'Mod+Shift+Z',
        'bold' => 'Mod+B',
        'italic' => 'Mod+I',
        'underline' => 'Mod+U',
        'strikethrough' => 'Mod+Shift+X',
        'inline_code' => 'Mod+E',
        'link' => 'Mod+K',
        'paragraph' => 'Mod+Alt+0',
        'heading_1' => 'Mod+Alt+1',
        'heading_2' => 'Mod+Alt+2',
        'heading_3' => 'Mod+Alt+3',
        'heading_4' => 'Mod+Alt+4',
        'heading_5' => 'Mod+Alt+5',
        'heading_6' => 'Mod+Alt+6',
        'bullet_list' => 'Mod+Shift+8',
        'ordered_list' => 'Mod+Shift+7',
        'blockquote' => 'Mod+Shift+9',
        'code_block' => 'Mod+Alt+C',
        'clear_formatting' => 'Mod+\\',
        'focus_toolbar' => 'Alt+F10',
    ],

    /*
    |--------------------------------------------------------------------------
    | Links
    |--------------------------------------------------------------------------
    */

    'links' => [
        'enabled' => true,
        'allow_new_tab' => true,
        // URL schemes accepted in links. Relative URLs are always accepted.
        'protocols' => ['http', 'https', 'mailto', 'tel'],
    ],

    /*
    |--------------------------------------------------------------------------
    | Images
    |--------------------------------------------------------------------------
    |
    | max_size is in megabytes. Percentage widths are stored as classes
    | (ipx-rte-w-50); pixel sizes are stored as width/height attributes.
    | Neither uses a style attribute.
    |
    */

    'images' => [
        'enabled' => true,
        'upload' => true,
        'allow_url' => true,
        'allowed_formats' => ['jpg', 'jpeg', 'png', 'gif', 'webp'],
        'allowed_mimes' => ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
        'max_size' => 5,
        'allow_alt' => true,
        'require_alt' => true,
        'allow_title' => true,
        'allow_caption' => true,
        'allow_classes' => true,
        // class => label. Only listed classes (and validated custom classes
        // when allowed) are kept on images.
        'classes' => [
            'ipx-rte-img--rounded' => 'Rounded corners',
            'ipx-rte-img--bordered' => 'Border',
            'ipx-rte-img--shadow' => 'Shadow',
        ],
        'allow_custom_classes' => false,
        'allow_dimensions' => true,
        'allow_height' => false,
        'dimension_units' => ['%', 'px'],
        // Percentages offered for width (and height). Supported values are
        // multiples of 5 between 5 and 100, plus 33 and 66.
        'percent_steps' => [25, 33, 50, 66, 75, 100],
        'max_pixels' => 4000,
        'allow_alignment' => true,
        'alignments' => ['left', 'center', 'right'],
        'allow_display' => true,
        'allow_paste_upload' => true,
    ],

    /*
    |--------------------------------------------------------------------------
    | File attachments
    |--------------------------------------------------------------------------
    |
    | Attachments are inserted as safe links (a.ipx-rte-attachment). Files
    | are never embedded. max_size is in megabytes.
    |
    */

    'files' => [
        'enabled' => false,
        'allowed_formats' => ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'txt', 'csv', 'zip'],
        'allowed_mimes' => [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.oasis.opendocument.text',
            'application/vnd.oasis.opendocument.spreadsheet',
            'text/plain',
            'text/csv',
            'application/zip',
            'application/x-zip-compressed',
        ],
        'max_size' => 10,
    ],

    /*
    |--------------------------------------------------------------------------
    | Uploads
    |--------------------------------------------------------------------------
    |
    | Point "url" at any endpoint in your application that follows the
    | documented upload contract, or enable the optional built-in route.
    | Client-side checks are a usability feature only: the endpoint must
    | validate every upload itself.
    |
    | Only "url" and "field" are sent to the browser. Disk, directory,
    | middleware and gate stay on the server.
    |
    */

    'uploads' => [
        'url' => env('RICHTEXT_UPLOAD_URL'),
        'field' => 'file',
        'disk' => env('RICHTEXT_UPLOAD_DISK', 'public'),
        'directory' => 'rich-text-editor',
        'visibility' => 'public',
        'route' => [
            'enabled' => false,
            'uri' => 'inertiapixel/rich-text-editor/uploads',
            'name' => 'inertiapixel.rich-text-editor.upload',
            'middleware' => ['web', 'auth'],
            // Optional Gate ability checked before every upload.
            'gate' => null,
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Tables
    |--------------------------------------------------------------------------
    |
    | Presets map a key to a label and produce ipx-rte-table--{key}. The
    | base class ipx-rte-table is always present. Add CSS for custom keys.
    |
    */

    'tables' => [
        'enabled' => true,
        'presets' => [
            'bordered' => 'Bordered',
            'striped' => 'Striped',
            'compact' => 'Compact',
            'responsive' => 'Responsive',
        ],
        'default_presets' => ['bordered'],
        'max_rows' => 50,
        'max_columns' => 12,
        'header_row' => true,
    ],

    /*
    |--------------------------------------------------------------------------
    | Character limits and counter
    |--------------------------------------------------------------------------
    |
    | Rich text counts visible characters (not tags); Markdown and plain text
    | count their source. The unit is Unicode code points, the same unit as
    | PHP's mb_strlen. null means "no limit"; 0 is a real limit.
    |
    */

    'limits' => [
        'min_chars' => null,
        'max_chars' => null,
        // Stop typing and pasting beyond max_chars instead of only warning.
        'enforce_max' => false,
        // Block form submission while a limit is not met.
        'validate_on_submit' => true,
    ],

    'counter' => [
        // null shows the counter automatically when a limit is set.
        'show' => null,
        'words' => false,
    ],

    /*
    |--------------------------------------------------------------------------
    | Paste
    |--------------------------------------------------------------------------
    */

    'paste' => [
        // "semantic" keeps safe structure and formatting, "text" always
        // pastes plain text. Mod+Shift+V pastes plain text in either case.
        'mode' => 'semantic',
        'allow_data_images' => false,
    ],

    /*
    |--------------------------------------------------------------------------
    | Accessibility
    |--------------------------------------------------------------------------
    */

    'accessibility' => [
        'aria_label' => null,
        // Announce limit changes through an aria-live region.
        'announce_limits' => true,
    ],

    /*
    |--------------------------------------------------------------------------
    | Assets
    |--------------------------------------------------------------------------
    |
    | "route"     serves the bundled assets through a package route (default,
    |             no publishing required).
    | "published" uses files copied to public/vendor/inertiapixel/
    |             rich-text-editor via vendor:publish.
    | "manual"    renders nothing; include the assets yourself.
    |
    */

    'assets' => [
        'mode' => 'route',
        'route_prefix' => 'inertiapixel/rich-text-editor/assets',
        // Optional base URL (for a CDN) used in "published" mode.
        'url' => null,
        // Render <link>/<script> automatically the first time an editor
        // is rendered in a request.
        'auto_inject' => true,
    ],

    /*
    |--------------------------------------------------------------------------
    | Unknown options
    |--------------------------------------------------------------------------
    |
    | "throw" rejects unknown keys passed through Blade :options; "ignore"
    | drops them silently. Unknown keys in this file are always ignored.
    |
    */

    'unknown_options' => 'throw',

];
