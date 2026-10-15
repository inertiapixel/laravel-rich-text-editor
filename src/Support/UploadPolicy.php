<?php

namespace InertiaPixel\RichTextEditor\Support;

/**
 * Normalises allowed upload formats and rejects types that can execute
 * code or script when served back from the application's origin.
 *
 * This is a guard against misconfiguration, not a replacement for the
 * upload endpoint's own validation.
 */
final class UploadPolicy
{
    public const DANGEROUS_EXTENSIONS = [
        'php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phtml', 'phar', 'pht', 'phps', 'inc',
        'cgi', 'pl', 'py', 'rb', 'sh', 'bash', 'zsh', 'bat', 'cmd', 'com', 'exe', 'dll', 'msi',
        'jar', 'js', 'mjs', 'cjs', 'vbs', 'ps1', 'asp', 'aspx', 'jsp', 'htm', 'html', 'xhtml',
        'shtml', 'svg', 'svgz', 'xml', 'xsl', 'htaccess', 'swf', 'hta', 'scr', 'app', 'apk', 'wasm',
    ];

    public const DANGEROUS_MIMES = [
        'text/html', 'application/xhtml+xml', 'image/svg+xml', 'application/xml', 'text/xml',
        'application/javascript', 'text/javascript', 'application/x-javascript',
        'application/x-httpd-php', 'application/x-php', 'text/x-php', 'application/x-sh',
        'application/x-msdownload', 'application/x-msdos-program', 'application/java-archive',
        'application/wasm', 'application/x-shockwave-flash',
    ];

    /**
     * @param  list<string>  $formats
     * @return list<string>
     */
    public static function extensions(array $formats, string $path): array
    {
        $extensions = [];

        foreach ($formats as $format) {
            $extension = strtolower(ltrim(trim($format), '.'));

            if ($extension === '' || ! preg_match('/^[a-z0-9]+$/', $extension)) {
                throw new InvalidOptionException("Invalid file extension [{$format}] in [{$path}].");
            }

            if (in_array($extension, self::DANGEROUS_EXTENSIONS, true)) {
                throw new InvalidOptionException("The file extension [{$extension}] in [{$path}] can execute code and is never allowed.");
            }

            $extensions[] = $extension;
        }

        return array_values(array_unique($extensions));
    }

    /**
     * @param  list<string>  $mimes
     * @return list<string>
     */
    public static function mimes(array $mimes, string $path): array
    {
        $normalized = [];

        foreach ($mimes as $mime) {
            $mime = strtolower(trim($mime));

            if (! preg_match('#^[a-z0-9.+-]+/[a-z0-9.+-]+$#', $mime)) {
                throw new InvalidOptionException("Invalid MIME type [{$mime}] in [{$path}].");
            }

            if (in_array($mime, self::DANGEROUS_MIMES, true)) {
                throw new InvalidOptionException("The MIME type [{$mime}] in [{$path}] can execute script and is never allowed.");
            }

            $normalized[] = $mime;
        }

        return array_values(array_unique($normalized));
    }

    public static function bytes(int|float $megabytes): int
    {
        return (int) round($megabytes * 1024 * 1024);
    }

    public static function kilobytes(int|float $megabytes): int
    {
        return (int) round($megabytes * 1024);
    }
}
