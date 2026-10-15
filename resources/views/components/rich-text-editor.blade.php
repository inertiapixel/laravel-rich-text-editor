@php
    $__ipxErrors = isset($errors) && $errors instanceof \Illuminate\Support\ViewErrorBag
        ? $errors->getBag($errorBag)
        : new \Illuminate\Support\MessageBag();
    $__ipxInvalid = $__ipxErrors->has($errorKey);
@endphp
{!! $assets !!}
<div {{ $attributes->class([
        $rootClass,
        'ipx-rte--invalid' => $__ipxInvalid,
        'ipx-rte--readonly' => $readonly,
        'ipx-rte--disabled' => $disabled,
    ])->merge(['id' => $rootId]) }}
    data-ipx-rte
    data-ipx-rte-config="{{ json_encode($clientConfig, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) }}"
>
    {{-- The first newline inside a textarea is dropped by the HTML parser, so one is emitted on purpose. --}}
    <textarea
        id="{{ $fieldId }}"
        name="{{ $name }}"
        class="ipx-rte__field"
        rows="8"
        @if ($ariaLabel) aria-label="{{ $ariaLabel }}" @endif
        @if ($placeholder) placeholder="{{ $placeholder }}" @endif
        @if ($__ipxInvalid) aria-invalid="true" aria-describedby="{{ $fieldId }}-error" @endif
        @required($required)
        @readonly($readonly)
        @disabled($disabled)
    >
{{ $initialValue }}</textarea>
@if ($formatFieldName)
    <input type="hidden" name="{{ $formatFieldName }}" value="{{ $initialFormat }}" data-ipx-rte-format @disabled($disabled)>
@endif
@if ($__ipxInvalid)
    <p class="ipx-rte__error" id="{{ $fieldId }}-error" data-ipx-rte-server-error>{{ $__ipxErrors->first($errorKey) }}</p>
@endif
</div>
