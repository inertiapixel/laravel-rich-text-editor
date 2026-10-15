<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Post</title>
</head>
<body>
    <article id="post">
        <x-inertiapixel::rich-text-content :content="$post['content'] ?? ''" :format="$post['content_format'] ?? 'html'" />
    </article>
</body>
</html>
