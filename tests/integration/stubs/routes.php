<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use InertiaPixel\RichTextEditor\Rules\RichTextLength;

Route::view('/posts/create', 'posts.create');

Route::post('/posts', function (Request $request) {
    $data = $request->validate([
        'content' => ['required', 'string', RichTextLength::between(10, 500)->format($request->input('content_format'))],
        'content_format' => ['required', 'in:html,markdown,text'],
    ]);

    $request->session()->put('post', $data);

    return redirect('/posts/show');
});

Route::get('/posts/show', fn (Request $request) => view('posts.show', ['post' => $request->session()->get('post')]));
