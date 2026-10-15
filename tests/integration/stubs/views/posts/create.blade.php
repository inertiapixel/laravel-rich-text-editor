<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>Create post</title>
</head>
<body>
    <form method="POST" action="/posts">
        @csrf
        <label for="article-content">Content</label>
        <x-inertiapixel::rich-text-editor
            name="content"
            id="article-content"
            :value="old('content', '')"
            placeholder="Write your article..."
            :min-chars="10"
            :max-chars="500"
            :options="['markdown' => true, 'plainText' => true]"
        />
        <button type="submit" id="save">Save</button>
        <button type="submit" id="save-unchecked" formnovalidate>Save without browser checks</button>
    </form>
</body>
</html>
