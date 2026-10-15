#!/usr/bin/env bash
#
# Creates a fresh Laravel application and installs this package the way
# Composer installs it from Packagist (a dist archive that honours
# .gitattributes export-ignore), then adds a demo form from stubs/.
#
# Usage: tests/integration/create-app.sh <target-dir> [laravel-constraint] [php-binary]
#   e.g. tests/integration/create-app.sh /tmp/ipx-app "^13.0" php
#
# Then: cd <target-dir> && php artisan serve --port=8765
#       IPX_APP_URL=http://127.0.0.1:8765 npx playwright test tests/browser/integration.spec.js
set -euo pipefail

TARGET="${1:?target directory required}"
LARAVEL="${2:-^13.0}"
PHP="${3:-php}"
COMPOSER="$(command -v composer)"
PACKAGE_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"

trap 'rm -rf "$WORK"' EXIT

# 1. Build a dist archive of the package.
rsync -a --exclude vendor --exclude node_modules --exclude composer.lock "$PACKAGE_DIR/" "$WORK/package/"
"$PHP" -r '$f = $argv[1]; $c = json_decode(file_get_contents($f), true); $c["version"] = "1.0.0"; file_put_contents($f, json_encode($c, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));' "$WORK/package/composer.json"
mkdir -p "$WORK/artifacts"
(cd "$WORK/package" && "$PHP" "$COMPOSER" archive --format=zip --dir="$WORK/artifacts" --file=inertiapixel-laravel-rich-text-editor-1.0.0 >/dev/null)

# 2. Create the application and require the package from the archive.
rm -rf "$TARGET"
"$PHP" "$COMPOSER" create-project laravel/laravel "$TARGET" "$LARAVEL" --prefer-dist --no-interaction --no-progress -q
mkdir -p "$TARGET/packages"
cp "$WORK/artifacts/"*.zip "$TARGET/packages/"
(cd "$TARGET" && "$PHP" "$COMPOSER" config repositories.inertiapixel artifact ./packages \
    && "$PHP" "$COMPOSER" require inertiapixel/laravel-rich-text-editor:1.0.0 --no-interaction --no-progress)

# 3. Add the demo form.
cp "$PACKAGE_DIR/tests/integration/stubs/routes.php" "$TARGET/routes/ipx-demo.php"
echo "require __DIR__.'/ipx-demo.php';" >> "$TARGET/routes/web.php"
mkdir -p "$TARGET/resources/views/posts"
cp "$PACKAGE_DIR/tests/integration/stubs/views/posts/"*.blade.php "$TARGET/resources/views/posts/"

echo "Application ready in $TARGET"
