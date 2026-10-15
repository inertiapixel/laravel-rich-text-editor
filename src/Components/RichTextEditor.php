<?php

namespace InertiaPixel\RichTextEditor\Components;

use Illuminate\Contracts\Support\Htmlable;
use Illuminate\Contracts\View\View;
use Illuminate\Support\Facades\Lang;
use Illuminate\View\Component;
use InertiaPixel\RichTextEditor\RichTextEditorServiceProvider;
use InertiaPixel\RichTextEditor\Support\AssetManager;
use InertiaPixel\RichTextEditor\Support\ClientConfig;
use InertiaPixel\RichTextEditor\Support\ConfigResolver;
use InertiaPixel\RichTextEditor\Support\FieldName;
use InertiaPixel\RichTextEditor\Support\InstanceRegistry;
use InertiaPixel\RichTextEditor\Support\InvalidOptionException;

class RichTextEditor extends Component
{
    public const FORMATS = ['html', 'markdown', 'text'];

    public string $fieldId;

    public string $rootId;

    public string $errorKey;

    public string $initialValue = '';

    public string $initialFormat = 'html';

    public ?string $formatFieldName = null;

    public string $assets = '';

    public string $rootClass = 'ipx-rte';

    /** @var array<string, mixed> */
    public array $clientConfig = [];

    /**
     * @param  array<string, mixed>  $options
     * @param  list<string>|string|null  $toolbar
     */
    public function __construct(
        public string $name,
        public ?string $id = null,
        public mixed $value = null,
        public ?string $placeholder = null,
        public ?string $mode = null,
        public ?string $format = null,
        public string|int|null $minHeight = null,
        public string|int|null $maxHeight = null,
        public bool|string $readonly = false,
        public bool|string $disabled = false,
        public bool|string $required = false,
        public array|string|null $toolbar = null,
        public array $options = [],
        public ?string $uploadUrl = null,
        public ?string $ariaLabel = null,
        public int|string|null $minChars = null,
        public int|string|null $maxChars = null,
        public bool|string|null $showCounter = null,
        public string $errorBag = 'default',
        public bool|string $oldInput = true,
    ) {
        if (trim($name) === '') {
            throw new InvalidOptionException('The InertiaPixel Rich Text Editor requires a non-empty "name".');
        }

        $this->readonly = self::toBool($readonly);
        $this->disabled = self::toBool($disabled);
        $this->required = self::toBool($required);
        $this->oldInput = self::toBool($oldInput);
    }

    public function render(): View
    {
        $resolved = app(ConfigResolver::class)->resolve($this->options, $this->attributeOptions());

        $registry = app(InstanceRegistry::class);
        $this->fieldId = $this->id !== null && $this->id !== '' ? $registry->claim($this->id) : $registry->uniqueId($this->name);
        $this->rootId = $this->fieldId.'-editor';
        $this->errorKey = FieldName::dot($this->name);
        $this->formatFieldName = FieldName::format($this->name, $resolved['format_field']);

        $modes = ClientConfig::modes($resolved);
        [$this->initialValue, $this->initialFormat] = $this->initialContent($modes['default']);

        $strings = Lang::get(RichTextEditorServiceProvider::NAME.'::editor');

        $this->clientConfig = ClientConfig::build($resolved, is_array($strings) ? $strings : [], app()->getLocale()) + [
            'field' => $this->fieldId,
            'formatField' => $this->formatFieldName,
            'initialFormat' => $this->initialFormat,
            'required' => $this->required,
            'readonly' => $this->readonly,
            'disabled' => $this->disabled,
            'ariaLabel' => $this->ariaLabel ?? $resolved['accessibility']['aria_label'],
            // Sent with upload requests; only included when uploads are possible.
            'csrfToken' => $this->csrfToken($resolved),
        ];

        $this->rootClass = trim('ipx-rte '.$resolved['classes']['root']);

        $assets = app(AssetManager::class);
        $this->assets = $assets->autoInject() ? $assets->editorTags() : '';

        return view(RichTextEditorServiceProvider::NAME.'::components.rich-text-editor');
    }

    /**
     * @param  array<string, mixed>  $resolved
     */
    private function csrfToken(array $resolved): ?string
    {
        $request = app('request');

        if (ClientConfig::uploadUrl($resolved) === null || ! $request->hasSession()) {
            return null;
        }

        return $request->session()->token();
    }

    /**
     * Dedicated attributes take precedence over :options.
     *
     * @return array<string, mixed>
     */
    private function attributeOptions(): array
    {
        $options = [];

        if ($this->placeholder !== null) {
            $options['placeholder'] = $this->placeholder;
        }

        if ($this->mode !== null && $this->mode !== '') {
            $options['default_mode'] = $this->mode;
        }

        if ($this->minHeight !== null && $this->minHeight !== '') {
            $options['min_height'] = $this->minHeight;
        }

        if ($this->maxHeight !== null && $this->maxHeight !== '') {
            $options['max_height'] = $this->maxHeight;
        }

        if ($this->toolbar !== null) {
            $options['toolbar'] = self::toolbarList($this->toolbar);
        }

        if ($this->uploadUrl !== null) {
            $options['uploads']['url'] = $this->uploadUrl;
        }

        // Explicit 0 is a real limit; only null/"" means "not set here".
        if ($this->minChars !== null && $this->minChars !== '') {
            $options['limits']['min_chars'] = $this->minChars;
        }

        if ($this->maxChars !== null && $this->maxChars !== '') {
            $options['limits']['max_chars'] = $this->maxChars;
        }

        if ($this->showCounter !== null && $this->showCounter !== '') {
            $options['counter']['show'] = self::toBool($this->showCounter);
        }

        return $options;
    }

    /**
     * @return array{0: string, 1: string}
     */
    private function initialContent(string $mode): array
    {
        $format = $this->format !== null && $this->format !== '' ? $this->format : ClientConfig::FORMAT_FOR_MODE[$mode];

        if (! in_array($format, self::FORMATS, true)) {
            throw new InvalidOptionException('The editor "format" must be one of [html, markdown, text].');
        }

        $value = self::stringValue($this->value);
        $request = app('request');

        if ($this->oldInput && $request->hasSession() && $request->session()->hasOldInput($this->errorKey)) {
            $value = self::stringValue($request->old($this->errorKey));

            if ($this->formatFieldName !== null) {
                $oldFormat = $request->old(FieldName::dot($this->formatFieldName));

                if (is_string($oldFormat) && in_array($oldFormat, self::FORMATS, true)) {
                    $format = $oldFormat;
                }
            }
        }

        return [$value, $format];
    }

    private static function stringValue(mixed $value): string
    {
        return match (true) {
            $value === null => '',
            $value instanceof Htmlable => $value->toHtml(),
            is_scalar($value), $value instanceof \Stringable => (string) $value,
            default => throw new InvalidOptionException('The editor "value" must be a string.'),
        };
    }

    /**
     * @param  list<string>|string  $toolbar
     * @return list<string>
     */
    private static function toolbarList(array|string $toolbar): array
    {
        if (is_array($toolbar)) {
            return array_values($toolbar);
        }

        preg_match_all('/\||[A-Za-z_]+/', $toolbar, $matches);

        return $matches[0];
    }

    private static function toBool(mixed $value): bool
    {
        if (is_string($value)) {
            return ! in_array(strtolower(trim($value)), ['false', '0', 'off', 'no'], true);
        }

        return (bool) $value;
    }
}
