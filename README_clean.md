# Trace Note clean deploy package

这是无 service-worker 的干净部署包，用于清理旧 PWA 缓存问题。

上传到 GitHub 仓库根目录后，建议仓库最终只保留：

- .nojekyll
- index.html
- manifest.json
- icon-192.png
- icon-512.png

请删除旧的 service-worker.js、icons 文件夹和多余 README 文件。手机端还需要清除 2071502902.github.io 的网站数据。
