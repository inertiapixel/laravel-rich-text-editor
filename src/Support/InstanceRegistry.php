<?php

namespace InertiaPixel\RichTextEditor\Support;

use Illuminate\Support\Str;

/**
 * Hands out unique, deterministic element IDs within one request.
 */
final class InstanceRegistry
{
    /** @var array<string, true> */
    private array $used = [];

    public function uniqueId(string $name): string
    {
        $base = 'ipx-rte-'.(Str::slug(str_replace(['[', ']', '.'], '-', $name)) ?: 'editor');
        $id = $base;
        $suffix = 2;

        while (isset($this->used[$id])) {
            $id = $base.'-'.$suffix++;
        }

        return $this->claim($id);
    }

    public function claim(string $id): string
    {
        $this->used[$id] = true;

        return $id;
    }
}
