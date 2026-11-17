# 测试说明

## 解析核心

    node test/make-fixtures.cjs
    node test/test-meta.cjs

覆盖 PNG 的 tEXt / zTXt / iTXt、JPEG EXIF、WebP EXIF 前缀、MP4 容器标签、WebM EBML Tags、GIF Comment、JSON、只有 workflow、无元数据、未知容器兜底扫描等情况。

## 浏览器 UI

    powershell -ExecutionPolicy Bypass -File test/run-ui-test.ps1

脚本会依次：构建 HTML → 生成测试样本 → 生成 demo-test.html → 启动无头 Chrome/Chromium/Edge → 执行 30 项 DOM 断言（文件载入、预览/详情切换、节点搜索、类别筛选、工作流图与缩放控制、任意节点参数抽屉、参数文本可选择、内容滚动与自定义滚动条、原始数据、导出对象、Markdown、文件筛选/移除/清空、无元数据状态）。

可用环境变量 CHROME_PATH 指定浏览器可执行文件；不指定时会自动查找 Playwright 的 Chromium、系统 Chrome 或 Edge。

生成的临时文件：test/fixtures/、demo-test.html、test/ui-result.html。
