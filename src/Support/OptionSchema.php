<?php

namespace InertiaPixel\RichTextEditor\Support;

/**
 * Describes every supported configuration key.
 *
 * A nested array is a section that merges key by key. A string is a leaf
 * type that replaces the inherited value. Section meta keys start with "@":
 *
 * - "@shorthand": a boolean given for the whole section sets this child,
 *   so `'images' => false` means `'images' => ['enabled' => false]`.
 * - "@config_only": the section is server-side and may not be overridden
 *   per instance through Blade options.
 *
 * Leaf types: bool, ?bool, int, ?int (optionally ":min" or ":min-max"),
 * number (int|float, optionally ":min"), string, ?string, enum:a,b,
 * ?enum:a,b, list:<type>, map:string, css_length, ?css_length,
 * format_field, class_list.
 */
final class OptionSchema
{
    public const MODES = ['rich', 'markdown', 'text', 'code'];

    public const TOOLBAR_ITEMS = [
        '|', 'undo', 'redo', 'paragraph', 'heading', 'bold', 'italic', 'underline', 'strikethrough',
        'inline_code', 'bullet_list', 'ordered_list', 'outdent', 'indent', 'align_left',
        'align_center', 'align_right', 'align_justify', 'link', 'unlink', 'blockquote',
        'code_block', 'horizontal_rule', 'image', 'file', 'table', 'clear_formatting',
    ];

    public const SHORTCUT_COMMANDS = [
        'undo', 'redo', 'bold', 'italic', 'underline', 'strikethrough', 'inline_code', 'link',
        'paragraph', 'heading_1', 'heading_2', 'heading_3', 'heading_4', 'heading_5', 'heading_6',
        'bullet_list', 'ordered_list', 'blockquote', 'code_block', 'clear_formatting', 'focus_toolbar',
    ];

    /**
     * @return array<string, mixed>
     */
    public static function definition(): array
    {
        $shortcuts = array_fill_keys(self::SHORTCUT_COMMANDS, '?string');

        return [
            'default_mode' => 'enum:rich,markdown,text,code',
            'mode_order' => 'list:enum:rich,markdown,text,code',
            'rich_text' => ['@shorthand' => 'enabled', 'enabled' => 'bool'],
            'markdown' => ['@shorthand' => 'enabled', 'enabled' => 'bool', 'preview' => 'bool'],
            'plain_text' => ['@shorthand' => 'enabled', 'enabled' => 'bool'],
            'code_view' => ['@shorthand' => 'enabled', 'enabled' => 'bool'],
            'format_field' => 'format_field',
            'placeholder' => '?string',
            'min_height' => '?css_length',
            'max_height' => '?css_length',
            'theme' => 'enum:light,dark,auto',
            'classes' => [
                'root' => 'class_list',
                'content' => 'class_list',
            ],
            'toolbar' => 'list:enum:'.implode(',', self::TOOLBAR_ITEMS),
            'headings' => 'list:int:1-6',
            'max_indent' => 'int:0-8',
            'shortcuts' => $shortcuts,
            'links' => [
                '@shorthand' => 'enabled',
                'enabled' => 'bool',
                'allow_new_tab' => 'bool',
                'protocols' => 'list:string',
            ],
            'images' => [
                '@shorthand' => 'enabled',
                'enabled' => 'bool',
                'upload' => 'bool',
                'allow_url' => 'bool',
                'allowed_formats' => 'list:string',
                'allowed_mimes' => 'list:string',
                'max_size' => 'number:0',
                'allow_alt' => 'bool',
                'require_alt' => 'bool',
                'allow_title' => 'bool',
                'allow_caption' => 'bool',
                'allow_classes' => 'bool',
                'classes' => 'map:string',
                'allow_custom_classes' => 'bool',
                'allow_dimensions' => 'bool',
                'allow_height' => 'bool',
                'dimension_units' => 'list:enum:%,px',
                'percent_steps' => 'list:int:5-100',
                'max_pixels' => 'int:1',
                'allow_alignment' => 'bool',
                'alignments' => 'list:enum:left,center,right',
                'allow_display' => 'bool',
                'allow_paste_upload' => 'bool',
            ],
            'files' => [
                '@shorthand' => 'enabled',
                'enabled' => 'bool',
                'allowed_formats' => 'list:string',
                'allowed_mimes' => 'list:string',
                'max_size' => 'number:0',
            ],
            'uploads' => [
                'url' => '?string',
                'field' => 'string',
                'disk' => '@config_only:string',
                'directory' => '@config_only:string',
                'visibility' => '@config_only:string',
                'route' => [
                    '@config_only' => true,
                    'enabled' => 'bool',
                    'uri' => 'string',
                    'name' => 'string',
                    'middleware' => 'list:string',
                    'gate' => '?string',
                ],
            ],
            'tables' => [
                '@shorthand' => 'enabled',
                'enabled' => 'bool',
                'presets' => 'map:string',
                'default_presets' => 'list:string',
                'max_rows' => 'int:1-500',
                'max_columns' => 'int:1-50',
                'header_row' => 'bool',
            ],
            'limits' => [
                'min_chars' => '?int:0',
                'max_chars' => '?int:0',
                'enforce_max' => 'bool',
                'validate_on_submit' => 'bool',
            ],
            'counter' => [
                'show' => '?bool',
                'words' => 'bool',
            ],
            'paste' => [
                'mode' => 'enum:semantic,text',
                'allow_data_images' => 'bool',
            ],
            'accessibility' => [
                'aria_label' => '?string',
                'announce_limits' => 'bool',
            ],
            'assets' => [
                '@config_only' => true,
                'mode' => 'enum:route,published,manual',
                'route_prefix' => 'string',
                'url' => '?string',
                'auto_inject' => 'bool',
            ],
            'unknown_options' => '@config_only:enum:throw,ignore',
        ];
    }
}
