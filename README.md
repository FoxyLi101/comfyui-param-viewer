# ComfyUI 参数查看器

一个**单文件、离线、零依赖**的网页小程序：把 ComfyUI 生成的图片 / 视频拖进来，读取文件内嵌的 <code>prompt</code> 与 <code>workflow</code>，按节点展示 class_type、输入值、连线来源和常用生成参数。

> **English:** A single-file, offline viewer for ComfyUI image/video metadata. Drag in generated files to inspect embedded <code>prompt</code>/<code>workflow</code>, every node input, the workflow graph (pan/zoom, click a node for its parameters), and export JSON or Markdown. No install, no server, no network.

> 直接双击 <code>comfyui-params.html</code> 即可使用，不需要安装 Python、Node 或任何服务。

## 快速开始

1. 双击 <code>comfyui-params.html</code>，或双击 <code>打开参数查看器.cmd</code>。
2. 把 ComfyUI 输出拖进页面；也可以点“选择文件夹”，一次载入整个 output 目录。
3. 在右侧查看：
   - **概览**：正向 / 负向提示词（默认完整展示，超长时可一键收起）、模型、LoRA、采样器、步数、CFG、种子、尺寸、输出节点。
   - **节点参数**：逐节点展示全部输入；链接会显示来源节点和输出槽位，可点击跳转；参数值支持鼠标拖动选择后用 Ctrl+C 复制。
   - **工作流**：SVG 流程图（支持拖动平移、滚轮/按钮缩放、复位；点击任意节点打开参数抽屉）、分组、静音 / 绕过节点、工作流节点表。
   - **原始数据**：<code>prompt</code> / <code>workflow</code> / 全部文本字段，可复制、下载。
4. 右上角可导出当前文件或全部文件的参数 JSON；“复制参数”会生成 Markdown 表格。

## 支持的文件

| 容器 | 读取位置 |
| --- | --- |
| PNG / APNG | <code>tEXt</code> / <code>zTXt</code> / <code>iTXt</code> 文本块，以及 <code>eXIf</code> |
| JPEG | EXIF <code>UserComment</code> / <code>ImageDescription</code>、COM 注释、XMP |
| WebP | EXIF 标签（含 <code>prompt:{...}</code> / <code>workflow:{...}</code> 形式）、XMP |
| GIF | Comment 扩展块、XMP |
| MP4 / MOV / M4V / AVIF | <code>moov/udta/meta/ilst</code> 标签（<code>©cmt</code>、<code>©des</code>、freeform 等）、uuid XMP |
| WebM / MKV | EBML Tags（<code>TagName</code> / <code>TagString</code>） |
| JSON | API prompt 或 UI workflow 文件 |
| 其它 | 在前 64MB 范围内扫描可识别的 ComfyUI JSON |

PNG/JPEG/WebP/GIF 超过 128MB 时只读前 40MB（元数据通常在前面）；MP4 通过定位 <code>moov</code> 读取；WebM 超过 128MB 时扫描首尾。实际使用中 ComfyUI 输出一般远小于这些上限。

## 参数是怎么还原的

- <code>prompt</code> 是 ComfyUI 的执行图，也是**参数值的权威来源**。节点参数页直接遍历每个节点的 <code>class_type</code> 与 <code>inputs</code>。
- <code>workflow</code> 是前端画布，用来补全节点标题、分组、布局、静音 / 绕过状态，并绘制流程图。
- 正 / 负提示词从采样器的 <code>positive</code> / <code>negative</code> 连线向上游追踪；模型、LoRA、latent 尺寸同样沿连线追踪。
- 如果文件只有 <code>workflow</code> 没有 <code>prompt</code>，节点值按 <code>widgets_values</code> 展示；常见节点（KSampler、CheckpointLoaderSimple、CLIPTextEncode 等）会映射为真实参数名，其它节点显示 <code>widget[n]</code>。页面会给出提示，这类参数名可能不准确。

## 为什么可能读不到

- ComfyUI 启动时加了 <code>--disable-metadata</code>，或保存节点关闭了 <code>save_metadata</code>。
- 文件被微信、截图工具、图床、转码器、修图软件重新编码，元数据被剥离。
- 视频保存节点没有把 prompt / workflow 写进容器标签。
- 文件只有 <code>workflow</code> 或只有 <code>prompt</code>；工具会尽量显示现有的一份。

元数据是**不可信输入**：本工具只把它当文本展示，不执行其中的任何代码，也不会据此访问网络。

## 隐私

所有解析都在浏览器本地完成，文件不会上传到任何服务器；页面不加载外部字体、脚本或图片，也不发起网络请求。可以断网使用。

## 开发

    # 修改 src/ 后重新生成单文件 HTML
    node build.mjs

    # 解析核心测试（需要 Node 18+）
    node test/make-fixtures.cjs
    node test/test-meta.cjs

    # 浏览器 UI 测试（自动查找 Chrome / Chromium）
    powershell -ExecutionPolicy Bypass -File test/run-ui-test.ps1

源码结构：

    src/comfy-meta.cjs    解析核心（PNG/EXIF/MP4/WebM/JSON + 节点与摘要）
    src/app.js            UI：文件、解析调度、侧栏、预览、标签页、概览、节点
    src/app-workflow.js   SVG 工作流图
    src/app-raw.js        原始数据、JSON 导出
    src/app-finish.js     Markdown、复制/下载、工具函数、启动
    src/style.css         样式
    src/template.html     页面骨架
    build.mjs             把以上内容内联成 comfyui-params.html

<code>src/app*.js</code> 是同一个 IIFE 的分段，不能单独运行；由 <code>build.mjs</code> 按顺序拼接。

## 已知限制

- 只读取文件内嵌的元数据，不读取 ComfyUI 的数据库、日志或 sidecar 文件。
- 不能还原已被重新编码删除的元数据，也不验证工作流能否实际运行。
- 超大的 workflow 流程图会按画布整体缩放；窄屏下可横向滚动查看。
- 浏览器需要支持 <code>DecompressionStream</code>（压缩 PNG 文本块）与 <code>color-mix</code>（少量配色）；建议 Chrome / Edge 111+、Firefox 113+、Safari 16.4+。普通 <code>tEXt</code> 元数据在更旧的浏览器也能读。

## License

MIT. See <code>LICENSE</code>.
