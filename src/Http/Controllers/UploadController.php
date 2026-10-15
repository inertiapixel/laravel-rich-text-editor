<?php

namespace InertiaPixel\RichTextEditor\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use InertiaPixel\RichTextEditor\Support\ConfigResolver;
use InertiaPixel\RichTextEditor\Support\UploadPolicy;

/**
 * Optional built-in upload endpoint.
 *
 * Its rules come only from the server's configuration. Options sent by an
 * editor instance (or a crafted request) can never widen them.
 */
final class UploadController
{
    public function __invoke(Request $request, ConfigResolver $resolver): JsonResponse
    {
        $config = $resolver->global();
        $uploads = $config['uploads'];
        $field = $uploads['field'];

        if (is_string($uploads['route']['gate']) && $uploads['route']['gate'] !== '') {
            Gate::authorize($uploads['route']['gate']);
        }

        $type = $request->input('type') === 'file' ? 'file' : 'image';
        $section = $type === 'image' ? $config['images'] : $config['files'];
        $enabled = $type === 'image'
            ? $section['enabled'] && $section['upload']
            : $section['enabled'];

        abort_unless($enabled, 403, $type === 'image' ? 'Image uploads are disabled.' : 'File uploads are disabled.');

        $configPath = $type === 'image' ? 'images' : 'files';
        $extensions = UploadPolicy::extensions($section['allowed_formats'], "{$configPath}.allowed_formats");
        $mimes = UploadPolicy::mimes($section['allowed_mimes'], "{$configPath}.allowed_mimes");

        $request->validate([
            $field => array_filter([
                'required',
                'file',
                'max:'.max(1, UploadPolicy::kilobytes($section['max_size'])),
                $extensions === [] ? null : 'extensions:'.implode(',', $extensions),
                $mimes === [] ? null : 'mimetypes:'.implode(',', $mimes),
            ]),
        ]);

        /** @var UploadedFile $file */
        $file = $request->file($field);
        $extension = strtolower($file->getClientOriginalExtension());
        $mime = strtolower((string) $file->getMimeType());

        if ($extensions === [] || $mimes === []
            || ! in_array($extension, $extensions, true)
            || in_array($mime, UploadPolicy::DANGEROUS_MIMES, true)) {
            throw ValidationException::withMessages([$field => __('inertiapixel-rich-text-editor::editor.file_type_not_allowed')]);
        }

        if ($type === 'image' && @getimagesize($file->getRealPath()) === false) {
            throw ValidationException::withMessages([$field => __('inertiapixel-rich-text-editor::editor.file_type_not_allowed')]);
        }

        // Never trust the client file name for storage.
        $path = $file->storeAs(
            trim($uploads['directory'], '/'),
            Str::random(40).'.'.$extension,
            ['disk' => $uploads['disk'], 'visibility' => $uploads['visibility']],
        );

        abort_if($path === false, 500, 'The file could not be stored.');

        return new JsonResponse([
            'url' => Storage::disk($uploads['disk'])->url($path),
            'name' => self::displayName($file->getClientOriginalName()),
            'size' => $file->getSize(),
            'mime' => $mime,
            'type' => $type,
        ], 201);
    }

    private static function displayName(string $name): string
    {
        $name = preg_replace('/[\x00-\x1F\x7F]/u', '', basename(str_replace('\\', '/', $name))) ?? '';

        return Str::limit($name, 200, '');
    }
}
