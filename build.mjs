/**
 * Development-only build: bundles resources/js and resources/css into
 * self-contained files in resources/dist. Consumers never run this.
 */

import { build, context } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const banner = '/*! InertiaPixel Rich Text Editor | MIT License | https://github.com/inertiapixel/laravel-rich-text-editor */';

const targets = ['chrome100', 'edge100', 'firefox100', 'safari15.4'];

const jsOptions = {
    entryPoints: ['resources/js/index.js'],
    outfile: 'resources/dist/inertiapixel-rich-text-editor.js',
    bundle: true,
    format: 'iife',
    minify: true,
    legalComments: 'none',
    target: targets,
    // The whole bundle runs in strict mode inside one IIFE.
    banner: { js: `${banner}\n"use strict";` },
};

async function buildCss() {
    await mkdir('resources/dist', { recursive: true });

    const editor = await readFile('resources/css/editor.css', 'utf8');
    const content = await readFile('resources/css/content.css', 'utf8');

    const minify = async (code) => (await build({
        stdin: { contents: code, loader: 'css' },
        write: false,
        minify: true,
        target: targets,
        legalComments: 'none',
    })).outputFiles[0].text;

    await writeFile('resources/dist/inertiapixel-rich-text-editor.css', `${banner}\n${await minify(`${content}\n${editor}`)}`);
    await writeFile('resources/dist/inertiapixel-rich-text-content.css', `${banner}\n${await minify(content)}`);
}

if (watch) {
    const ctx = await context(jsOptions);
    await ctx.watch();
    await buildCss();
    console.log('Watching resources/js (CSS is rebuilt on restart).');
} else {
    await build(jsOptions);
    await buildCss();
    console.log('Built resources/dist.');
}
