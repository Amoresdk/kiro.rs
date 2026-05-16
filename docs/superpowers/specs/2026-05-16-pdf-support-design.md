# PDF 支持能力 设计文档

- 创建日期：2026-05-16
- 适用项目：kiro-rs（即 kiro2api，Anthropic ↔ Kiro 反代）
- 状态：草案（待用户确认）

## 1. 背景

kiro-rs 把 Anthropic Messages API 协议反代到 Kiro 上游协议。当前实现中：

- 入参侧：`src/anthropic/types.rs:230` 的 `ContentBlock` 已能识别 `text` / `image` / `tool_use` / `tool_result`，但**不识别** Anthropic 标准的 `document` block。
- 出参侧：`src/kiro/model/requests/conversation.rs:95` 定义的 `UserInputMessage` 只有 `content: String` + `images: Vec<KiroImage>`，**没有** PDF / 文档字段。
- 转换器：`src/anthropic/converter.rs:343` 的 `process_message_content` 只对 `text` / `image` / `tool_result` / `tool_use` 分支分发，遇到 `document` 走 `_ => {}` 被静默丢弃。

**结论**：客户端按 Anthropic 标准在请求里挂 PDF 时，反代当前会**完全忽略**这一段，模型那边什么都看不到。

## 2. 目标

- 客户端按 Anthropic 标准协议在 `messages[].content` 中挂 PDF（`type: "document"`、`source.type: "base64"`、`source.media_type: "application/pdf"`），反代将 PDF **抽取为纯文本**，注入发往 Kiro 的 `UserInputMessage.content`，让模型可以"读到" PDF 内容。
- 既覆盖 `messages` 数组里**当前 user 消息**中的 PDF，也覆盖**历史 user 消息**中的 PDF（与现有 `image` 处理对齐）。
- 失败行为透明：解析失败、空文本、超限等情况以 4xx 明确报错，不静默降级，便于客户端排错。

## 3. 非目标（Out of Scope）

- 不支持扫描件型 PDF（PDF 内容本身是图片栅格）。这类 PDF 抽取得到空文本时直接报错。
- 不支持 Anthropic `document` block 中的 `source.type: "url"` 与 `"file_id"`，仅支持 `"base64"`。
- 不实现 PDF 渲染成图片的回退方案。
- 不修改 Kiro 上游协议结构（不向 `UserInputMessage` 加新字段）。
- 不改 admin-ui。
- 不实现 Files API、附件持久化、缓存。

## 4. 总体方案

PDF 内容在反代内部**就地**完成"PDF → 文本"，再合并进现有 `content: String`，对 Kiro 上游而言一切照旧。具体路径：

```
Anthropic 请求
  └─ messages[i].content[j] = { type: "document", source: { type: "base64", media_type: "application/pdf", data: "<base64>" } }
       │
       ▼  src/anthropic/converter.rs::process_message_content
  识别 "document" 分支
       │
       ▼
  PdfTextExtractor trait
       │   默认实现：基于 pdf-extract crate
       ▼
  抽取出纯文本
       │
       ▼
  按 <document index="N"> ... </document> 包裹后追加到 text_parts
       │
       ▼
  与原有 text 一起 join("\n") 写入 UserInputMessage.content
       │
       ▼
  正常发往 Kiro 上游
```

**核心设计点**：

1. **零侵入 Kiro 协议**：`UserInputMessage` 不变，PDF 文本"伪装"成普通文本送上游。
2. **抽象 trait**：把"PDF 字节 → 文本"封装成 `PdfTextExtractor` trait，默认 `PdfExtractExtractor` 用 `pdf-extract` crate 实现，方便日后替换为 `lopdf` / `mupdf` / OCR。
3. **明确失败而非静默降级**：解析错误、加密、扫描件、超限都返回结构化错误，在 handler 层映射成 4xx。
4. **配置可调**：限制项放进 `Config`，不把硬编码留在代码里。

## 5. 接口契约

### 5.1 入参（Anthropic 协议侧）

仅支持以下形态的 `document` content block：

```json
{
  "type": "document",
  "source": {
    "type": "base64",
    "media_type": "application/pdf",
    "data": "<base64-encoded PDF bytes>"
  }
}
```

可选字段（如 `title`、`citations`）解析但仅 `title` 用于在 `<document>` 包裹中作为 `<source>`。其它字段忽略。

**不支持的形态会按以下规则处理**：

| 形态 | 行为 |
|---|---|
| `source.type` 不是 `"base64"` | 4xx：`document_unsupported_source` |
| `media_type` 不是 `"application/pdf"` | 4xx：`document_unsupported_media_type` |
| `data` 解码失败（非合法 base64） | 4xx：`document_invalid_base64` |
| 解码后字节数 > 限额 | 4xx：`document_too_large` |
| `pdf-extract` 解析失败（加密/损坏） | 4xx：`document_parse_failed` |
| 抽取出的文本为空（扫描件常见） | 4xx：`document_empty_text` |
| 抽取文本字符数 > 限额 | 4xx：`document_text_too_large` |

错误响应沿用现有 Anthropic 风格 JSON：`{"type":"error","error":{"type":"invalid_request_error","message":"..."}}`。具体 HTTP 状态：均为 400。

### 5.2 出参（Kiro 协议侧）

PDF 文本会按 Anthropic 官方 prompt engineering 习惯用 XML 包裹，附加到 `UserInputMessage.content` 里：

```text
<原本的 text 内容（如有）>

<document index="1">
<source>{title 或 "document.pdf"}</source>
<document_content>
{抽取出的 PDF 文本}
</document_content>
</document>

<document index="2">
...
</document>
```

规则：

- 一条用户消息中多个 PDF 按出现顺序编号 `index="1"`、`index="2"`，编号在**单条消息内**重置。
- `<source>` 取 Anthropic `document` block 的 `title` 字段，缺省用 `"document.pdf"`。
- 包裹的位置：紧跟在原本 text 内容之后。这样 PDF 看起来像"用户在末尾贴了一份资料"，对模型最自然。
- 历史消息中的 PDF 也走同样的处理路径，保留在 `HistoryUserMessage` 内。

### 5.3 配置

新增 `Config` 字段（位于 `src/model/config.rs:23`）：

```rust
/// PDF 支持配置
#[serde(default)]
pub pdf: PdfConfig,
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfConfig {
    /// 是否启用 PDF 支持（默认 true）
    #[serde(default = "default_pdf_enabled")]
    pub enabled: bool,
    /// 单 PDF 解码后字节数上限（默认 32 MB）
    #[serde(default = "default_pdf_max_bytes")]
    pub max_bytes: usize,
    /// 单 PDF 抽取文本字符数上限（默认 500_000）
    #[serde(default = "default_pdf_max_text_chars")]
    pub max_text_chars: usize,
}
```

默认值：`enabled = true`、`max_bytes = 32 * 1024 * 1024`、`max_text_chars = 500_000`。

`enabled = false` 时，遇到 `document` block 直接返回 `document_disabled` 错误（明确而非静默忽略）。

## 6. 模块与代码组织

新增模块 `src/anthropic/pdf/`：

```
src/anthropic/pdf/
  mod.rs        // 对外 re-export，定义 trait
  extractor.rs  // PdfTextExtractor trait + 默认实现 PdfExtractExtractor
  error.rs      // PdfError，映射到 ConversionError
```

**职责边界**：

- `extractor.rs::PdfTextExtractor`：纯函数式接口。
  ```rust
  pub trait PdfTextExtractor: Send + Sync {
      fn extract_text(&self, pdf_bytes: &[u8]) -> Result<String, PdfError>;
  }
  ```
  默认实现 `PdfExtractExtractor`（无字段，零状态）调用 `pdf_extract::extract_text_from_mem`。
- `error.rs::PdfError`：枚举，覆盖 `Decode`、`Empty`、`TooLarge`、`TextTooLarge`、`Disabled`、`UnsupportedSource`、`UnsupportedMediaType` 等分支，实现 `Display` 和 `From<base64 解码错误>`。
- `mod.rs`：把上述两者 re-export，并提供 `process_pdf_block(block, cfg, extractor) -> Result<String, PdfError>`，输入 `ContentBlock` 与配置，输出 `<document>...</document>` 包裹后的字符串。
- 仅 `mod.rs::process_pdf_block` 暴露给 `converter.rs`。

**`converter.rs` 改动点**：

1. 顶部 `use` 加 `super::pdf::{PdfTextExtractor, PdfExtractExtractor, process_pdf_block, PdfError}`。
2. `process_message_content` 签名增加 `pdf_ctx: &PdfContext`（`PdfContext` 内含 `cfg: &PdfConfig` 和 `extractor: &dyn PdfTextExtractor`），并在分支中加入 `"document" => { ... }`。
3. `ConversionError` 增加 `Pdf(PdfError)` 变体，`Display` 中委托 `PdfError`。
4. `convert_request` 上层注入 `PdfContext`（详见 §7）。
5. `merge_user_messages` 同步更新签名。

**`anthropic/handlers.rs` 改动点**：

- 注入 `PdfContext`：在 `AppState` 持有一个 `Arc<dyn PdfTextExtractor>`（默认值为 `PdfExtractExtractor`），并把 `cfg.pdf` 也带进去。
- 4xx 映射：在 `ConversionError::Pdf(PdfError::*)` 处统一返回 400 与上面表格中的 `error.message`。

**`anthropic/types.rs` 改动点**：

- `ContentBlock` 新增字段以容纳 document 必要属性：
  - `title: Option<String>`（`document` block 可选 title）
  - 现有 `source: Option<ImageSource>` 直接复用——`ImageSource` 改名为更中性的 `BlockSource`，结构不变（`source_type`、`media_type`、`data`），保留旧名 `ImageSource` 作为类型别名以零回归。

> 备注：之所以复用 `BlockSource` 是因为 `image` 与 `document` 的 source 形状一致（都是 `{type, media_type, data}`），合并后逻辑更直白。

## 7. 数据流

### 7.1 启动期

1. `main.rs` 加载 `Config`（含 `pdf` 段）。
2. 构造默认 `Arc<dyn PdfTextExtractor> = Arc::new(PdfExtractExtractor)`。
3. 注入 `AppState`。

### 7.2 单次请求处理

1. Axum handler 收到 `MessagesRequest`。
2. 调用 `converter::convert_request(req, &pdf_ctx)`。
3. `convert_request` 依次走"当前消息构造 + 历史合并"，遇到 `document` block 调用 `process_pdf_block`：
   1. 校验 `source.type == "base64"` 且 `media_type == "application/pdf"`。
   2. base64 解码。
   3. 校验字节数 ≤ `pdf.max_bytes`。
   4. 调 `extractor.extract_text(bytes)`。
   5. 校验文本非空 + 字符数 ≤ `pdf.max_text_chars`。
   6. 用 `<document index="N">...</document>` 包裹返回。
4. `process_message_content` 把 PDF 包裹文本 push 到 `text_parts`。
5. 后续走原有路径，`text_parts.join("\n")` 进 `UserInputMessage.content`。

### 7.3 错误路径

任一校验失败：
- `process_pdf_block` 返回 `Err(PdfError::*)`。
- `process_message_content` 透传为 `ConversionError::Pdf(...)`。
- `convert_request` 透传给 handler。
- handler 返回 400 + Anthropic 风格 error JSON。

## 8. 依赖

新增 Cargo 依赖：

```toml
pdf-extract = "0.7"   # 纯 Rust PDF 文本提取
base64 = "0.22"       # base64 解码（项目当前无显式依赖，需要新增）
```

> 验证项：在 writing-plans 阶段先确认 `pdf-extract` 当前版本号和 MSRV 与项目 `edition = "2024"`、当前 toolchain 兼容；如不兼容则改用 `lopdf` 自实现或 `pdf-extract` 锁定具体次版本。

## 9. 测试策略

新增 `tests/pdf/` 子目录，按"重要模块独立子文件夹"约定：

- `tests/pdf/fixtures/`：放置若干测试用 PDF
  - `simple_text.pdf`：纯文本 PDF，含中英文
  - `multi_page.pdf`：多页文本 PDF
  - `encrypted.pdf`：带密码的 PDF
  - `scanned.pdf`：纯图片扫描件
  - `corrupt.pdf`：故意损坏的字节
- `tests/pdf/extractor_test.rs`：直接调用 `PdfExtractExtractor`，覆盖：抽取成功、加密失败、扫描件得空文本、损坏字节失败。
- `tests/pdf/converter_test.rs`：构造含 `document` block 的 `MessagesRequest`，断言：
  - 单 PDF：`<document index="1"><source>...</source><document_content>...</document_content></document>` 出现在 `current_message.user_input_message.content`。
  - 多 PDF + text 混排：编号正确、顺序正确。
  - 历史 user 消息中的 PDF 也被处理。
  - 各错误分支返回对应 `ConversionError::Pdf` 变体。
- `tests/pdf/config_test.rs`：`pdf.enabled = false` 时返回 `PdfError::Disabled`；超限大小 / 超限字符数返回对应错误。

接受标准：`cargo test` 全绿；现有测试零回归（`ImageSource` 改 `BlockSource` 时确保旧测试可通过类型别名编译通过）。

## 10. 安全性

- **资源消耗**：`pdf.max_bytes` 与 `pdf.max_text_chars` 是必要护栏。32 MB 上限可阻止内存炸弹型 PDF。
- **解析库的 panic**：`pdf-extract` 历史上对脏 PDF 偶有 panic。在 `PdfExtractExtractor::extract_text` 内用 `std::panic::catch_unwind` 兜住，转为 `PdfError::Decode("panic during extraction")`，避免单个请求拖垮 worker。
- **不做远程拉取**：明确不支持 `url` source，自然规避 SSRF。
- **base64 size guard 前置**：先按"base64 字符串长度 × 0.75 ≤ max_bytes"做粗判，再实际解码，避免大字符串解码后才发现超限。
- **日志**：错误日志只记录 PDF 字节数、错误类型，不打印 PDF 原始字节或抽取出的文本片段。

## 11. 兼容性

- 客户端不发 `document` block：行为 100% 等同今日，无任何回归。
- 客户端发 `document` block 但 `pdf.enabled=false`：返回 400，错误明确。
- 客户端发非 base64 PDF：返回 400，引导其换为 base64。
- `ImageSource` → `BlockSource` 重命名仅影响内部，外部 JSON 字段名 `source` / `type` / `media_type` / `data` 不变，`ContentBlock` 序列化形态完全兼容。

## 12. 风险与权衡

| 风险 | 缓解 |
|---|---|
| `pdf-extract` 对中文/复杂版面提取质量参差 | trait 抽象保留替换空间；测试用例覆盖中文 PDF；文档明确说明限制 |
| 超大 PDF 抽出超长文本撑爆上游 token | `max_text_chars` 默认 500k 字符护栏；超限直接 4xx |
| 抽取耗时阻塞 axum 异步任务 | 在 handler 中用 `tokio::task::spawn_blocking` 包裹 `extract_text` 调用 |
| 扫描件用户预期"应该能读到" | 错误信息明确提示"PDF 似乎是扫描件，请提供文本型 PDF" |
| 加密 PDF | 错误信息明确提示"PDF 已加密，反代不支持解密" |

## 13. 实施顺序（供 writing-plans 参考）

1. 新增 `Config.pdf` 段与默认值；不接通使用方，确保现有测试全绿。
2. 新增 `src/anthropic/pdf/` 模块骨架（trait + error + 默认实现），单元测试覆盖 extractor。
3. `ContentBlock` 加 `title` 字段；`ImageSource` 改名 `BlockSource`（保留别名）。
4. `process_message_content` 加 `document` 分支；`ConversionError::Pdf` 变体。
5. `convert_request` 与 `merge_user_messages` 接入 `PdfContext`；handler 注入。
6. 4xx 错误映射；端到端 converter_test 全绿。
7. `tokio::task::spawn_blocking` 包裹 `extract_text`，避免阻塞。
8. `panic::catch_unwind` 兜住 `pdf-extract`。
9. 文档更新：README 增加"PDF 支持"小节，说明协议形态、限制、错误码。

## 14. 验收清单

- [ ] `cargo build --release` 成功。
- [ ] `cargo test` 全绿，新增测试覆盖所有错误分支。
- [ ] 手工：用 curl 发一份小 PDF，模型回复中能看到 PDF 内容。
- [ ] 手工：发扫描件 PDF，得到 400 + `document_empty_text`。
- [ ] 手工：发 50 MB PDF（超 32 MB），得到 400 + `document_too_large`。
- [ ] 手工：`pdf.enabled = false` 时，发 PDF 得到 400 + `document_disabled`。
- [ ] 手工：不发 PDF 的请求行为与改动前一致。

