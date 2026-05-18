# PDF 支持能力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 kiro-rs 支持 Anthropic 协议中的 PDF `document` content block：在反代内部把 base64 PDF 抽成纯文本，用 `<document index="N">` 包裹后注入 Kiro `UserInputMessage.content`，扫描件/加密/超限统一返回 400。

**Architecture:** 在 `src/anthropic/` 下新增 `pdf/` 子模块：`PdfTextExtractor` trait + 默认 `PdfExtractExtractor`（基于 `pdf-extract` crate）+ `PdfError`。`process_message_content` 在分发循环里加 `"document"` 分支，调用 `process_pdf_block` 拿到包裹好的字符串后追加到 `text_parts`，对 Kiro 上游协议结构零改动。新配置段 `Config.pdf` 控制启用与限额。

**Tech Stack:** Rust edition 2024, axum 0.8, tokio, serde, `pdf-extract = "0.7"`, `base64 = "0.22"`，内联 `#[cfg(test)] mod tests` + 顶级 `tests/` 集成测试目录（含 PDF fixtures）。

**spec 引用：** [`docs/superpowers/specs/2026-05-16-pdf-support-design.md`](../specs/2026-05-16-pdf-support-design.md)

---

## 任务概览

| # | 主题 | 文件 |
|---|---|---|
| 1 | 新增 `Config.pdf` 段 | `src/model/config.rs` |
| 2 | 新增依赖 + `PdfError` | `Cargo.toml`、`src/anthropic/pdf/error.rs` |
| 3 | `PdfTextExtractor` trait + 默认实现 | `src/anthropic/pdf/extractor.rs` |
| 4 | PDF fixtures 与 extractor 集成测试 | `tests/pdf_extractor.rs`、`tests/fixtures/pdf/*.pdf` |
| 5 | `ImageSource` 重命名为 `BlockSource`，`ContentBlock` 加 `title` | `src/anthropic/types.rs` |
| 6 | `PdfContext` + `process_pdf_block` 包裹器 | `src/anthropic/pdf/mod.rs` |
| 7 | `ConversionError::Pdf` 变体 + `process_message_content` 分发 | `src/anthropic/converter.rs` |
| 8 | `convert_request` / `merge_user_messages` 接入 `PdfContext` | `src/anthropic/converter.rs` |
| 9 | `AppState` 注入 extractor + handler 4xx 映射 | `src/anthropic/middleware.rs`、`src/anthropic/handlers.rs`、`src/anthropic/router.rs`、`src/main.rs` |
| 10 | extractor 调用包 `spawn_blocking` + `catch_unwind` | `src/anthropic/pdf/extractor.rs` |
| 11 | converter 端到端集成测试 | `tests/pdf_converter.rs` |
| 12 | README 增加 "PDF 支持" 小节 | `README.md` |

---

## File Structure

```
Cargo.toml                                    # 新依赖：pdf-extract, base64
src/model/config.rs                           # 加 PdfConfig
src/anthropic/pdf/
  mod.rs                                      # 入口：re-export + PdfContext + process_pdf_block
  error.rs                                    # PdfError 枚举
  extractor.rs                                # PdfTextExtractor trait + PdfExtractExtractor
src/anthropic/types.rs                        # ImageSource → BlockSource，ContentBlock 加 title
src/anthropic/converter.rs                    # ConversionError::Pdf + document 分支接入
src/anthropic/middleware.rs                   # AppState 加 pdf_extractor + pdf_config
src/anthropic/handlers.rs                     # PDF 错误的 4xx 映射，convert_request 调用点更新
src/anthropic/router.rs                       # AppState::new 调用点更新
src/anthropic/mod.rs                          # 暴露 pdf 子模块
src/main.rs                                   # 把 config.pdf 与默认 extractor 注入 router
tests/pdf_extractor.rs                        # PdfExtractExtractor 集成测试
tests/pdf_converter.rs                        # convert_request 端到端测试
tests/fixtures/pdf/
  simple_text.pdf                             # 纯文本 PDF
  multi_page.pdf                              # 多页 PDF
  encrypted.pdf                               # 加密 PDF
  scanned.pdf                                 # 扫描件 PDF（无文本）
  corrupt.pdf                                 # 故意损坏字节
README.md                                     # 加 "PDF 支持" 小节
```

每个文件职责单一：error/extractor/mod 拆三个文件，避免单文件过大。

---

### Task 1: 新增 `Config.pdf` 段

**Files:**
- Modify: `src/model/config.rs`
- Test: `src/model/config.rs`（内联 `#[cfg(test)]` 模块——若不存在则在文件末尾新增）

- [ ] **Step 1: 在 `Config` 结构体中加 `pdf` 字段**

在 `src/model/config.rs:23` 的 `Config` 结构体内（`endpoints` 字段下方、`config_path` 上方）插入：

```rust
    /// PDF 支持配置
    #[serde(default)]
    pub pdf: PdfConfig,
```

- [ ] **Step 2: 在文件中新增 `PdfConfig` 结构体**

在 `Config` 结构体定义之后、`fn default_host()` 之前插入：

```rust
/// PDF 支持配置
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

impl Default for PdfConfig {
    fn default() -> Self {
        Self {
            enabled: default_pdf_enabled(),
            max_bytes: default_pdf_max_bytes(),
            max_text_chars: default_pdf_max_text_chars(),
        }
    }
}

fn default_pdf_enabled() -> bool {
    true
}

fn default_pdf_max_bytes() -> usize {
    32 * 1024 * 1024
}

fn default_pdf_max_text_chars() -> usize {
    500_000
}
```

- [ ] **Step 3: 在 `Config::default()` 实现里加 `pdf: PdfConfig::default()`**

在 `src/model/config.rs:163` 起的 `impl Default for Config` 块内，于 `endpoints: HashMap::new(),` 之后、`config_path: None,` 之前新增一行：

```rust
            pdf: PdfConfig::default(),
```

- [ ] **Step 4: 在文件末尾新增（或追加到既有）测试模块**

在文件末尾（如尚无 `#[cfg(test)] mod tests` 则新建一个）：

```rust
#[cfg(test)]
mod pdf_config_tests {
    use super::*;

    #[test]
    fn pdf_config_defaults() {
        let cfg = PdfConfig::default();
        assert!(cfg.enabled);
        assert_eq!(cfg.max_bytes, 32 * 1024 * 1024);
        assert_eq!(cfg.max_text_chars, 500_000);
    }

    #[test]
    fn pdf_config_deserialized_from_partial_json() {
        let cfg: PdfConfig = serde_json::from_str(r#"{"enabled":false}"#).unwrap();
        assert!(!cfg.enabled);
        assert_eq!(cfg.max_bytes, 32 * 1024 * 1024);
    }

    #[test]
    fn config_with_default_pdf_round_trip() {
        let cfg = Config::default();
        let json = serde_json::to_string(&cfg).unwrap();
        let parsed: Config = serde_json::from_str(&json).unwrap();
        assert!(parsed.pdf.enabled);
    }

    #[test]
    fn config_without_pdf_field_falls_back_to_defaults() {
        let cfg: Config = serde_json::from_str(r#"{}"#).unwrap();
        assert!(cfg.pdf.enabled);
        assert_eq!(cfg.pdf.max_bytes, 32 * 1024 * 1024);
        assert_eq!(cfg.pdf.max_text_chars, 500_000);
    }
}
```

- [ ] **Step 5: 跑测试验证**

Run:

```bash
cargo test -p kiro-rs --lib pdf_config_tests
```

Expected: 4 个测试全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml src/model/config.rs
git commit -m "feat(config): 新增 PdfConfig 段，控制 PDF 解析启用与限额"
```

---

### Task 2: 新增依赖 + `PdfError`

**Files:**
- Modify: `Cargo.toml`
- Create: `src/anthropic/pdf/error.rs`
- Modify: `src/anthropic/mod.rs`
- Test: 内联在 `src/anthropic/pdf/error.rs`

- [ ] **Step 1: 在 `Cargo.toml` 的 `[dependencies]` 末尾新增依赖**

在 `Cargo.toml` 的 `[dependencies]` 段末尾（`mime_guess = "2"` 之后）追加：

```toml
pdf-extract = "0.7"   # 纯 Rust PDF 文本提取
base64 = "0.22"       # base64 解码（PDF document block）
```

- [ ] **Step 2: 验证依赖能解析**

Run:

```bash
cargo fetch
```

Expected: 退出码 0，无 "no matching package" 错误。如果失败，把版本改成 `pdf-extract = "0.6"` 或运行 `cargo search pdf-extract` 选最新发布版本。

- [ ] **Step 3: 在 `src/anthropic/mod.rs` 中暴露 `pdf` 子模块**

读取 `src/anthropic/mod.rs`，在末尾追加：

```rust
pub mod pdf;
```

- [ ] **Step 4: 创建 `src/anthropic/pdf/mod.rs`（最小占位，后续 Task 6 填充）**

```rust
//! PDF 处理模块
//!
//! 把 Anthropic `document` content block 抽取为纯文本，
//! 用于注入 Kiro `UserInputMessage.content`。

pub mod error;
pub mod extractor;

pub use error::PdfError;
```

- [ ] **Step 5: 创建 `src/anthropic/pdf/error.rs`**

```rust
//! PDF 处理过程中的错误类型

use std::fmt;

/// PDF 处理错误
#[derive(Debug)]
pub enum PdfError {
    /// 反代未启用 PDF 支持
    Disabled,
    /// `document.source.type` 不是 "base64"
    UnsupportedSource(String),
    /// `document.source.media_type` 不是 "application/pdf"
    UnsupportedMediaType(String),
    /// `document.source` 缺失或字段不全
    MissingSource,
    /// base64 解码失败
    InvalidBase64(String),
    /// 解码后字节数超过 `pdf.max_bytes`
    TooLarge { bytes: usize, limit: usize },
    /// `pdf-extract` 解析失败（加密 / 损坏 / 内部 panic）
    ParseFailed(String),
    /// 抽取出的文本为空（典型扫描件）
    EmptyText,
    /// 抽取文本字符数超过 `pdf.max_text_chars`
    TextTooLarge { chars: usize, limit: usize },
}

impl PdfError {
    /// 对外暴露的稳定错误码（用于 Anthropic 错误响应 message 前缀，便于客户端识别）
    pub fn code(&self) -> &'static str {
        match self {
            PdfError::Disabled => "document_disabled",
            PdfError::UnsupportedSource(_) => "document_unsupported_source",
            PdfError::UnsupportedMediaType(_) => "document_unsupported_media_type",
            PdfError::MissingSource => "document_missing_source",
            PdfError::InvalidBase64(_) => "document_invalid_base64",
            PdfError::TooLarge { .. } => "document_too_large",
            PdfError::ParseFailed(_) => "document_parse_failed",
            PdfError::EmptyText => "document_empty_text",
            PdfError::TextTooLarge { .. } => "document_text_too_large",
        }
    }
}

impl fmt::Display for PdfError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PdfError::Disabled => write!(f, "{}: PDF 支持未启用", self.code()),
            PdfError::UnsupportedSource(t) => {
                write!(f, "{}: 仅支持 source.type=base64，收到 {}", self.code(), t)
            }
            PdfError::UnsupportedMediaType(m) => write!(
                f,
                "{}: 仅支持 media_type=application/pdf，收到 {}",
                self.code(),
                m
            ),
            PdfError::MissingSource => write!(f, "{}: document.source 缺失或格式错误", self.code()),
            PdfError::InvalidBase64(reason) => {
                write!(f, "{}: base64 解码失败 ({})", self.code(), reason)
            }
            PdfError::TooLarge { bytes, limit } => write!(
                f,
                "{}: PDF 解码后 {} 字节超过上限 {} 字节",
                self.code(),
                bytes,
                limit
            ),
            PdfError::ParseFailed(reason) => write!(
                f,
                "{}: PDF 解析失败 ({})。可能是加密或损坏文件",
                self.code(),
                reason
            ),
            PdfError::EmptyText => write!(
                f,
                "{}: PDF 抽取文本为空，可能是扫描件，请提供文本型 PDF",
                self.code()
            ),
            PdfError::TextTooLarge { chars, limit } => write!(
                f,
                "{}: PDF 抽取文本 {} 字符超过上限 {} 字符",
                self.code(),
                chars,
                limit
            ),
        }
    }
}

impl std::error::Error for PdfError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_is_stable_for_each_variant() {
        assert_eq!(PdfError::Disabled.code(), "document_disabled");
        assert_eq!(
            PdfError::UnsupportedSource("url".into()).code(),
            "document_unsupported_source"
        );
        assert_eq!(
            PdfError::UnsupportedMediaType("image/png".into()).code(),
            "document_unsupported_media_type"
        );
        assert_eq!(PdfError::MissingSource.code(), "document_missing_source");
        assert_eq!(
            PdfError::InvalidBase64("bad".into()).code(),
            "document_invalid_base64"
        );
        assert_eq!(
            PdfError::TooLarge { bytes: 100, limit: 50 }.code(),
            "document_too_large"
        );
        assert_eq!(
            PdfError::ParseFailed("x".into()).code(),
            "document_parse_failed"
        );
        assert_eq!(PdfError::EmptyText.code(), "document_empty_text");
        assert_eq!(
            PdfError::TextTooLarge { chars: 10, limit: 5 }.code(),
            "document_text_too_large"
        );
    }

    #[test]
    fn display_includes_code() {
        let e = PdfError::TooLarge { bytes: 1000, limit: 100 };
        let s = format!("{}", e);
        assert!(s.contains("document_too_large"));
        assert!(s.contains("1000"));
        assert!(s.contains("100"));
    }
}
```

- [ ] **Step 6: 创建占位 `src/anthropic/pdf/extractor.rs`（Task 3 填充正式实现）**

```rust
//! PDF 文本提取器

// Task 3 填充
```

- [ ] **Step 7: 验证编译**

Run:

```bash
cargo build
```

Expected: 编译成功。

- [ ] **Step 8: 跑测试验证**

Run:

```bash
cargo test -p kiro-rs anthropic::pdf::error
```

Expected: `code_is_stable_for_each_variant` 与 `display_includes_code` 两个 PASS。

- [ ] **Step 9: Commit**

```bash
git add Cargo.toml Cargo.lock src/anthropic/mod.rs src/anthropic/pdf/
git commit -m "feat(pdf): 新增 pdf-extract/base64 依赖与 PdfError 错误类型"
```

---

### Task 3: `PdfTextExtractor` trait + 默认实现

**Files:**
- Modify: `src/anthropic/pdf/extractor.rs`
- Modify: `src/anthropic/pdf/mod.rs`
- Test: 内联在 `src/anthropic/pdf/extractor.rs`

- [ ] **Step 1: 写第一个失败测试（默认实现可被构造并实现 trait）**

把 `src/anthropic/pdf/extractor.rs` 替换为：

```rust
//! PDF 文本提取器
//!
//! `PdfTextExtractor` 是反代内部"PDF 字节 → 文本"的唯一抽象，
//! 默认实现 `PdfExtractExtractor` 基于 `pdf-extract` crate。
//! 未来若要替换为 `lopdf` / `mupdf` / OCR，仅需新增实现并替换注入。

use super::error::PdfError;

/// PDF 文本提取器
pub trait PdfTextExtractor: Send + Sync {
    /// 从 PDF 字节抽取纯文本。失败时返回 `PdfError::ParseFailed`。
    fn extract_text(&self, pdf_bytes: &[u8]) -> Result<String, PdfError>;
}

/// 基于 `pdf-extract` crate 的默认实现
#[derive(Debug, Default, Clone, Copy)]
pub struct PdfExtractExtractor;

impl PdfTextExtractor for PdfExtractExtractor {
    fn extract_text(&self, pdf_bytes: &[u8]) -> Result<String, PdfError> {
        pdf_extract::extract_text_from_mem(pdf_bytes)
            .map_err(|e| PdfError::ParseFailed(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corrupt_bytes_yield_parse_failed() {
        let extractor = PdfExtractExtractor;
        let result = extractor.extract_text(b"not a pdf at all");
        assert!(matches!(result, Err(PdfError::ParseFailed(_))));
    }

    #[test]
    fn empty_bytes_yield_parse_failed() {
        let extractor = PdfExtractExtractor;
        let result = extractor.extract_text(b"");
        assert!(matches!(result, Err(PdfError::ParseFailed(_))));
    }

    #[test]
    fn extractor_is_object_safe() {
        // trait 必须是 dyn-safe，handler 层会以 Arc<dyn PdfTextExtractor> 注入
        fn _accepts_dyn(_: &dyn PdfTextExtractor) {}
        _accepts_dyn(&PdfExtractExtractor);
    }
}
```

- [ ] **Step 2: 在 `src/anthropic/pdf/mod.rs` 中 re-export**

把 `src/anthropic/pdf/mod.rs` 替换为：

```rust
//! PDF 处理模块
//!
//! 把 Anthropic `document` content block 抽取为纯文本，
//! 用于注入 Kiro `UserInputMessage.content`。

pub mod error;
pub mod extractor;

pub use error::PdfError;
pub use extractor::{PdfExtractExtractor, PdfTextExtractor};
```

- [ ] **Step 3: 跑测试验证**

Run:

```bash
cargo test -p kiro-rs anthropic::pdf::extractor
```

Expected: 3 个 PASS。如果 `pdf-extract` crate API 在所选版本不是 `extract_text_from_mem`，把第 21 行换成该版本对应的 `extract_text(&Cursor::new(pdf_bytes))` 等价调用，重跑测试通过。

- [ ] **Step 4: 验证整包编译**

Run:

```bash
cargo build
```

Expected: 编译成功，无未使用 import 警告。

- [ ] **Step 5: Commit**

```bash
git add src/anthropic/pdf/extractor.rs src/anthropic/pdf/mod.rs
git commit -m "feat(pdf): PdfTextExtractor trait 与 pdf-extract 默认实现"
```

---

### Task 4: PDF fixtures 与 extractor 集成测试

**Files:**
- Create: `tests/fixtures/pdf/simple_text.pdf`
- Create: `tests/fixtures/pdf/multi_page.pdf`
- Create: `tests/fixtures/pdf/encrypted.pdf`
- Create: `tests/fixtures/pdf/scanned.pdf`
- Create: `tests/fixtures/pdf/corrupt.pdf`
- Create: `tests/fixtures/pdf/README.md`
- Create: `tests/pdf_extractor.rs`

- [ ] **Step 1: 准备目录**

Run:

```bash
mkdir -p tests/fixtures/pdf
```

- [ ] **Step 2: 生成 `simple_text.pdf`**

任选一种方式（不要把这一步外包给二进制 PDF 编辑器以外的工具）：

(a) 如果系统装了 `wkhtmltopdf`：

```bash
echo "Hello PDF! 你好 PDF。This is a single-page text PDF used by kiro-rs tests." > /tmp/simple.txt
wkhtmltopdf /tmp/simple.txt tests/fixtures/pdf/simple_text.pdf
```

(b) 如果系统装了 macOS 自带的 `cupsfilter`：

```bash
cupsfilter /tmp/simple.txt > tests/fixtures/pdf/simple_text.pdf
```

(c) 兜底：用 Python 一次性生成（需要 `pip install reportlab`）：

```python
# tests/fixtures/pdf/_make_simple.py（生成后可删）
from reportlab.pdfgen import canvas
c = canvas.Canvas("tests/fixtures/pdf/simple_text.pdf")
c.setFont("Helvetica", 14)
c.drawString(100, 750, "Hello PDF!")
c.drawString(100, 720, "This is a single-page text PDF used by kiro-rs tests.")
c.save()
```

```bash
python tests/fixtures/pdf/_make_simple.py && rm tests/fixtures/pdf/_make_simple.py
```

- [ ] **Step 3: 生成 `multi_page.pdf`（至少 2 页，每页含可识别文本）**

用 Python（reportlab）：

```python
# tests/fixtures/pdf/_make_multi.py
from reportlab.pdfgen import canvas
c = canvas.Canvas("tests/fixtures/pdf/multi_page.pdf")
c.setFont("Helvetica", 14)
c.drawString(100, 750, "Page one content marker AAA")
c.showPage()
c.drawString(100, 750, "Page two content marker BBB")
c.showPage()
c.save()
```

```bash
python tests/fixtures/pdf/_make_multi.py && rm tests/fixtures/pdf/_make_multi.py
```

- [ ] **Step 4: 生成 `encrypted.pdf`（加密 PDF）**

```bash
# 先把 simple_text.pdf 拷一份再用 qpdf 加密；如未装 qpdf：brew install qpdf
qpdf --encrypt secret123 secret123 256 -- tests/fixtures/pdf/simple_text.pdf tests/fixtures/pdf/encrypted.pdf
```

如系统没有 `qpdf`，改用 Python：

```python
# tests/fixtures/pdf/_make_enc.py
from pypdf import PdfReader, PdfWriter
r = PdfReader("tests/fixtures/pdf/simple_text.pdf")
w = PdfWriter()
for p in r.pages:
    w.add_page(p)
w.encrypt("secret123")
with open("tests/fixtures/pdf/encrypted.pdf", "wb") as f:
    w.write(f)
```

```bash
python tests/fixtures/pdf/_make_enc.py && rm tests/fixtures/pdf/_make_enc.py
```

- [ ] **Step 5: 生成 `scanned.pdf`（无文本，纯图片）**

```python
# tests/fixtures/pdf/_make_scan.py
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
c = canvas.Canvas("tests/fixtures/pdf/scanned.pdf", pagesize=letter)
# 画一个填充矩形模拟扫描位图，不放任何文字
c.setFillColorRGB(0.2, 0.2, 0.2)
c.rect(50, 50, 500, 700, fill=1)
c.save()
```

```bash
python tests/fixtures/pdf/_make_scan.py && rm tests/fixtures/pdf/_make_scan.py
```

- [ ] **Step 6: 生成 `corrupt.pdf`（故意损坏字节）**

```bash
printf '%%PDF-1.4\nthis is intentionally corrupted bytes for kiro-rs tests\n%%%%EOF\n' > tests/fixtures/pdf/corrupt.pdf
```

- [ ] **Step 7: 创建 `tests/fixtures/pdf/README.md` 说明用途**

```markdown
# PDF 测试 fixture

| 文件 | 用途 |
|---|---|
| simple_text.pdf | 单页含 "Hello PDF!" 文本，验证抽取成功路径 |
| multi_page.pdf | 多页，每页含 marker AAA/BBB，验证多页连续抽取 |
| encrypted.pdf | 用 secret123 加密，验证解析失败路径 |
| scanned.pdf | 无文本仅图形，验证 EmptyText 路径 |
| corrupt.pdf | 故意损坏的字节序列，验证 ParseFailed 路径 |

如需重新生成，参考 `docs/superpowers/plans/2026-05-16-pdf-support.md` Task 4 步骤。
```

- [ ] **Step 8: 创建 `tests/pdf_extractor.rs`**

```rust
//! PdfExtractExtractor 集成测试，使用 tests/fixtures/pdf/ 下的真实 PDF。

use kiro_rs::anthropic::pdf::{PdfError, PdfExtractExtractor, PdfTextExtractor};

fn load(name: &str) -> Vec<u8> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/pdf")
        .join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("无法读取 fixture {}: {}", path.display(), e))
}

#[test]
fn simple_text_pdf_yields_known_marker() {
    let bytes = load("simple_text.pdf");
    let text = PdfExtractExtractor.extract_text(&bytes).expect("应抽取成功");
    assert!(
        text.contains("Hello PDF"),
        "抽取的文本应包含 'Hello PDF'，实际：{:?}",
        text
    );
}

#[test]
fn multi_page_pdf_contains_each_page_marker() {
    let bytes = load("multi_page.pdf");
    let text = PdfExtractExtractor.extract_text(&bytes).expect("应抽取成功");
    assert!(text.contains("AAA"), "缺少第一页 marker：{:?}", text);
    assert!(text.contains("BBB"), "缺少第二页 marker：{:?}", text);
}

#[test]
fn encrypted_pdf_yields_parse_failed() {
    let bytes = load("encrypted.pdf");
    let result = PdfExtractExtractor.extract_text(&bytes);
    assert!(
        matches!(result, Err(PdfError::ParseFailed(_))),
        "加密 PDF 应返回 ParseFailed，实际：{:?}",
        result
    );
}

#[test]
fn scanned_pdf_yields_empty_string() {
    // 注意：trait 只负责"抽文本"，"空文本→EmptyText"是上层职责。
    // 这里仅验证抽取出的字符串经 trim 后为空。
    let bytes = load("scanned.pdf");
    let text = PdfExtractExtractor.extract_text(&bytes).expect("扫描件能解析但文本为空");
    assert!(
        text.trim().is_empty(),
        "扫描件应得到空文本，实际：{:?}",
        text
    );
}

#[test]
fn corrupt_pdf_yields_parse_failed() {
    let bytes = load("corrupt.pdf");
    let result = PdfExtractExtractor.extract_text(&bytes);
    assert!(
        matches!(result, Err(PdfError::ParseFailed(_))),
        "损坏 PDF 应返回 ParseFailed，实际：{:?}",
        result
    );
}
```

- [ ] **Step 9: 暴露 crate 公共入口（让 `kiro_rs::anthropic::pdf` 在集成测试可见）**

集成测试访问的是 `kiro_rs` 这个 lib crate。本项目目前是 `[package] name = "kiro-rs"` + 单 binary，需要确认 `lib.rs` 存在或存在 `pub mod`。读取 `src/main.rs` 顶部，如果有 `mod anthropic;`，则需要把 anthropic 暴露成可被外部使用——做法：在 `src/main.rs` 同级新建 `src/lib.rs`：

```rust
//! kiro-rs 库入口（供集成测试访问内部模块）
pub mod admin;
pub mod admin_ui;
pub mod anthropic;
pub mod common;
pub mod debug;
pub mod http_client;
pub mod kiro;
pub mod model;
pub mod token;
```

并相应地在 `src/main.rs` 中把所有 `mod xxx;` 改成 `use kiro_rs::xxx;`。

> 验证项：在执行此 step 前先 `grep "^mod " src/main.rs` 确认实际的模块清单，确保 `lib.rs` 完整覆盖；遗漏会导致 binary 编译失败。

并在 `Cargo.toml` 的 `[package]` 之后追加（如不存在）：

```toml
[lib]
name = "kiro_rs"
path = "src/lib.rs"

[[bin]]
name = "kiro-rs"
path = "src/main.rs"
```

- [ ] **Step 10: 跑集成测试**

Run:

```bash
cargo test --test pdf_extractor
```

Expected: 5 个测试 PASS。如果 `simple_text` / `multi_page` 失败说明 fixture 生成方式产生了非文本流（如 reportlab 默认嵌入字体），改用 Step 2/3 的(a)(b)分支或调整文本字体即可。

- [ ] **Step 11: Commit**

```bash
git add tests/ src/lib.rs src/main.rs Cargo.toml
git commit -m "test(pdf): extractor 集成测试与 PDF fixtures"
```

---

### Task 5: `ImageSource` 重命名为 `BlockSource`，`ContentBlock` 加 `title`

**Files:**
- Modify: `src/anthropic/types.rs`
- Test: 内联在 `src/anthropic/types.rs`

- [ ] **Step 1: 重命名结构体并保留别名**

把 `src/anthropic/types.rs:255` 起的 `ImageSource` 定义改为：

```rust
/// content block 数据源（image 与 document 共用）
#[derive(Debug, Deserialize, Serialize)]
pub struct BlockSource {
    #[serde(rename = "type")]
    pub source_type: String,
    pub media_type: String,
    pub data: String,
}

/// 历史别名：保持旧名 `ImageSource` 可用，零回归
pub type ImageSource = BlockSource;
```

- [ ] **Step 2: 在 `ContentBlock` 中新增 `title` 字段**

在 `src/anthropic/types.rs:230` 起的 `ContentBlock` 内，于 `pub source: Option<ImageSource>,` 之后新增：

```rust
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
```

- [ ] **Step 3: 在文件末尾追加 / 扩展测试模块**

```rust
#[cfg(test)]
mod content_block_tests {
    use super::*;

    #[test]
    fn block_source_alias_compiles() {
        let s: ImageSource = BlockSource {
            source_type: "base64".into(),
            media_type: "image/png".into(),
            data: "AAA".into(),
        };
        assert_eq!(s.source_type, "base64");
    }

    #[test]
    fn document_block_with_title_round_trip() {
        let raw = r#"{
            "type": "document",
            "title": "report.pdf",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": "JVBERi0="
            }
        }"#;
        let block: ContentBlock = serde_json::from_str(raw).unwrap();
        assert_eq!(block.block_type, "document");
        assert_eq!(block.title.as_deref(), Some("report.pdf"));
        let src = block.source.as_ref().unwrap();
        assert_eq!(src.source_type, "base64");
        assert_eq!(src.media_type, "application/pdf");
        assert_eq!(src.data, "JVBERi0=");
    }

    #[test]
    fn legacy_image_block_without_title_still_parses() {
        let raw = r#"{
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": "AAA"
            }
        }"#;
        let block: ContentBlock = serde_json::from_str(raw).unwrap();
        assert!(block.title.is_none());
        assert_eq!(block.source.unwrap().media_type, "image/png");
    }
}
```

- [ ] **Step 4: 跑测试验证**

Run:

```bash
cargo test -p kiro-rs --lib content_block_tests
```

Expected: 3 个 PASS。

- [ ] **Step 5: 验证整包编译（确保改动未破坏 `converter.rs` 中所有 `ImageSource` 用法）**

Run:

```bash
cargo build
```

Expected: 成功，无错误。

- [ ] **Step 6: Commit**

```bash
git add src/anthropic/types.rs
git commit -m "refactor(anthropic): ImageSource → BlockSource，ContentBlock 新增 title"
```

---

### Task 6: `PdfContext` + `process_pdf_block` 包裹器

**Files:**
- Modify: `src/anthropic/pdf/mod.rs`
- Test: 内联在 `src/anthropic/pdf/mod.rs`

- [ ] **Step 1: 在 `mod.rs` 中追加 `PdfContext` 与核心包裹函数**

把 `src/anthropic/pdf/mod.rs` 替换为：

```rust
//! PDF 处理模块

pub mod error;
pub mod extractor;

pub use error::PdfError;
pub use extractor::{PdfExtractExtractor, PdfTextExtractor};

use base64::{Engine, engine::general_purpose::STANDARD};

use crate::anthropic::types::ContentBlock;
use crate::model::config::PdfConfig;

/// 反代 PDF 处理上下文
///
/// 由 handler 注入到 converter，把"配置 + 提取器"打包传递。
#[derive(Clone)]
pub struct PdfContext<'a> {
    pub config: &'a PdfConfig,
    pub extractor: &'a dyn PdfTextExtractor,
}

/// 单消息内的 `<document>` 编号计数器
pub struct DocumentCounter(usize);

impl DocumentCounter {
    pub fn new() -> Self {
        Self(0)
    }
    pub fn next_index(&mut self) -> usize {
        self.0 += 1;
        self.0
    }
}

impl Default for DocumentCounter {
    fn default() -> Self {
        Self::new()
    }
}

/// 处理一个 `document` content block，返回 `<document index="N">...</document>` 包裹的字符串
pub fn process_pdf_block(
    block: &ContentBlock,
    counter: &mut DocumentCounter,
    ctx: &PdfContext<'_>,
) -> Result<String, PdfError> {
    if !ctx.config.enabled {
        return Err(PdfError::Disabled);
    }

    let source = block.source.as_ref().ok_or(PdfError::MissingSource)?;

    if source.source_type != "base64" {
        return Err(PdfError::UnsupportedSource(source.source_type.clone()));
    }

    if source.media_type != "application/pdf" {
        return Err(PdfError::UnsupportedMediaType(source.media_type.clone()));
    }

    // 粗判 base64 字符串长度（每 4 字符约解码 3 字节），避免大字符串解码后才发现超限
    let approx_decoded = (source.data.len() / 4) * 3;
    if approx_decoded > ctx.config.max_bytes {
        return Err(PdfError::TooLarge {
            bytes: approx_decoded,
            limit: ctx.config.max_bytes,
        });
    }

    let bytes = STANDARD
        .decode(&source.data)
        .map_err(|e| PdfError::InvalidBase64(e.to_string()))?;

    if bytes.len() > ctx.config.max_bytes {
        return Err(PdfError::TooLarge {
            bytes: bytes.len(),
            limit: ctx.config.max_bytes,
        });
    }

    let text = ctx.extractor.extract_text(&bytes)?;

    if text.trim().is_empty() {
        return Err(PdfError::EmptyText);
    }

    if text.chars().count() > ctx.config.max_text_chars {
        return Err(PdfError::TextTooLarge {
            chars: text.chars().count(),
            limit: ctx.config.max_text_chars,
        });
    }

    let title = block.title.as_deref().unwrap_or("document.pdf");
    let index = counter.next_index();

    Ok(format!(
        "<document index=\"{}\">\n<source>{}</source>\n<document_content>\n{}\n</document_content>\n</document>",
        index,
        escape_xml(title),
        text
    ))
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::anthropic::types::BlockSource;

    /// 测试用 extractor：忽略输入字节，返回固定文本
    struct FakeExtractor(String);
    impl PdfTextExtractor for FakeExtractor {
        fn extract_text(&self, _: &[u8]) -> Result<String, PdfError> {
            Ok(self.0.clone())
        }
    }

    /// 测试用：始终失败
    struct FailingExtractor;
    impl PdfTextExtractor for FailingExtractor {
        fn extract_text(&self, _: &[u8]) -> Result<String, PdfError> {
            Err(PdfError::ParseFailed("forced".into()))
        }
    }

    fn cfg() -> PdfConfig {
        PdfConfig::default()
    }

    fn doc_block(data: &str, title: Option<&str>) -> ContentBlock {
        ContentBlock {
            block_type: "document".into(),
            text: None,
            thinking: None,
            tool_use_id: None,
            content: None,
            name: None,
            input: None,
            id: None,
            is_error: None,
            source: Some(BlockSource {
                source_type: "base64".into(),
                media_type: "application/pdf".into(),
                data: data.into(),
            }),
            title: title.map(String::from),
        }
    }

    #[test]
    fn happy_path_wraps_with_document_tag_and_title() {
        let extractor = FakeExtractor("hello pdf".into());
        let cfg = cfg();
        let ctx = PdfContext { config: &cfg, extractor: &extractor };
        let block = doc_block("JVBERi0xLjQK", Some("report.pdf"));
        let mut counter = DocumentCounter::new();
        let s = process_pdf_block(&block, &mut counter, &ctx).unwrap();
        assert!(s.contains("<document index=\"1\">"));
        assert!(s.contains("<source>report.pdf</source>"));
        assert!(s.contains("hello pdf"));
        assert!(s.ends_with("</document>"));
    }

    #[test]
    fn missing_title_falls_back_to_default_filename() {
        let extractor = FakeExtractor("x".into());
        let cfg = cfg();
        let ctx = PdfContext { config: &cfg, extractor: &extractor };
        let block = doc_block("JVBERi0K", None);
        let mut counter = DocumentCounter::new();
        let s = process_pdf_block(&block, &mut counter, &ctx).unwrap();
        assert!(s.contains("<source>document.pdf</source>"));
    }

    #[test]
    fn counter_increments_within_message() {
        let extractor = FakeExtractor("x".into());
        let cfg = cfg();
        let ctx = PdfContext { config: &cfg, extractor: &extractor };
        let block = doc_block("JVBERi0K", None);
        let mut counter = DocumentCounter::new();
        let a = process_pdf_block(&block, &mut counter, &ctx).unwrap();
        let b = process_pdf_block(&block, &mut counter, &ctx).unwrap();
        assert!(a.contains("index=\"1\""));
        assert!(b.contains("index=\"2\""));
    }

    #[test]
    fn disabled_returns_disabled_error() {
        let extractor = FakeExtractor("x".into());
        let mut cfg = cfg();
        cfg.enabled = false;
        let ctx = PdfContext { config: &cfg, extractor: &extractor };
        let block = doc_block("JVBERi0K", None);
        let mut counter = DocumentCounter::new();
        assert!(matches!(
            process_pdf_block(&block, &mut counter, &ctx),
            Err(PdfError::Disabled)
        ));
    }

    #[test]
    fn unsupported_source_type_returns_error() {
        let extractor = FakeExtractor("x".into());
        let cfg = cfg();
        let ctx = PdfContext { config: &cfg, extractor: &extractor };
        let mut block = doc_block("JVBERi0K", None);
        block.source.as_mut().unwrap().source_type = "url".into();
        let mut counter = DocumentCounter::new();
        assert!(matches!(
            process_pdf_block(&block, &mut counter, &ctx),
            Err(PdfError::UnsupportedSource(_))
        ));
    }

    #[test]
    fn unsupported_media_type_returns_error() {
        let extractor = FakeExtractor("x".into());
        let cfg = cfg();
        let ctx = PdfContext { config: &cfg, extractor: &extractor };
        let mut block = doc_block("JVBERi0K", None);
        block.source.as_mut().unwrap().media_type = "image/png".into();
        let mut counter = DocumentCounter::new();
        assert!(matches!(
            process_pdf_block(&block, &mut counter, &ctx),
            Err(PdfError::UnsupportedMediaType(_))
        ));
    }

    #[test]
    fn invalid_base64_returns_error() {
        let extractor = FakeExtractor("x".into());
        let cfg = cfg();
        let ctx = PdfContext { config: &cfg, extractor: &extractor };
        let block = doc_block("not_base64!!!", None);
        let mut counter = DocumentCounter::new();
        assert!(matches!(
            process_pdf_block(&block, &mut counter, &ctx),
            Err(PdfError::InvalidBase64(_))
        ));
    }

    #[test]
    fn too_large_returns_error() {
        let extractor = FakeExtractor("x".into());
        let mut cfg = cfg();
        cfg.max_bytes = 4; // 极小阈值
        let ctx = PdfContext { config: &cfg, extractor: &extractor };
        // base64 编码后长度足以超过 4 字节阈值
        let block = doc_block("JVBERi0xLjQKJSDLi/wKMSAwIG9iago=", None);
        let mut counter = DocumentCounter::new();
        let r = process_pdf_block(&block, &mut counter, &ctx);
        assert!(matches!(r, Err(PdfError::TooLarge { .. })), "实际：{:?}", r);
    }

    #[test]
    fn empty_text_returns_empty_text_error() {
        let extractor = FakeExtractor("   \n  ".into());
        let cfg = cfg();
        let ctx = PdfContext { config: &cfg, extractor: &extractor };
        let block = doc_block("JVBERi0K", None);
        let mut counter = DocumentCounter::new();
        assert!(matches!(
            process_pdf_block(&block, &mut counter, &ctx),
            Err(PdfError::EmptyText)
        ));
    }

    #[test]
    fn text_too_large_returns_error() {
        let extractor = FakeExtractor("x".repeat(100));
        let mut cfg = cfg();
        cfg.max_text_chars = 50;
        let ctx = PdfContext { config: &cfg, extractor: &extractor };
        let block = doc_block("JVBERi0K", None);
        let mut counter = DocumentCounter::new();
        assert!(matches!(
            process_pdf_block(&block, &mut counter, &ctx),
            Err(PdfError::TextTooLarge { .. })
        ));
    }

    #[test]
    fn extractor_error_is_propagated() {
        let extractor = FailingExtractor;
        let cfg = cfg();
        let ctx = PdfContext { config: &cfg, extractor: &extractor };
        let block = doc_block("JVBERi0K", None);
        let mut counter = DocumentCounter::new();
        assert!(matches!(
            process_pdf_block(&block, &mut counter, &ctx),
            Err(PdfError::ParseFailed(_))
        ));
    }

    #[test]
    fn xml_in_title_is_escaped() {
        let extractor = FakeExtractor("x".into());
        let cfg = cfg();
        let ctx = PdfContext { config: &cfg, extractor: &extractor };
        let block = doc_block("JVBERi0K", Some("<bad>&\""));
        let mut counter = DocumentCounter::new();
        let s = process_pdf_block(&block, &mut counter, &ctx).unwrap();
        assert!(s.contains("&lt;bad&gt;&amp;&quot;"));
    }

    #[test]
    fn missing_source_returns_error() {
        let extractor = FakeExtractor("x".into());
        let cfg = cfg();
        let ctx = PdfContext { config: &cfg, extractor: &extractor };
        let mut block = doc_block("JVBERi0K", None);
        block.source = None;
        let mut counter = DocumentCounter::new();
        assert!(matches!(
            process_pdf_block(&block, &mut counter, &ctx),
            Err(PdfError::MissingSource)
        ));
    }
}
```

- [ ] **Step 2: 跑测试验证**

Run:

```bash
cargo test -p kiro-rs --lib anthropic::pdf
```

Expected: 全部 PASS（约 13 个测试）。

- [ ] **Step 3: Commit**

```bash
git add src/anthropic/pdf/mod.rs
git commit -m "feat(pdf): PdfContext 与 process_pdf_block 包裹器"
```

---

### Task 7: `ConversionError::Pdf` 变体 + `process_message_content` 分发

**Files:**
- Modify: `src/anthropic/converter.rs`

> 本 task 暂不修改 `convert_request` / `merge_user_messages` 的对外签名，先在 converter 内部用一个**临时**的"测试用零配置 ctx"在测试模块中调，让分发逻辑独立可测。Task 8 再把 ctx 串到调用链。

- [ ] **Step 1: 扩展 `ConversionError`**

把 `src/anthropic/converter.rs:131` 起的 `ConversionError` 改为：

```rust
/// 转换错误
#[derive(Debug)]
pub enum ConversionError {
    UnsupportedModel(String),
    EmptyMessages,
    Pdf(crate::anthropic::pdf::PdfError),
}

impl std::fmt::Display for ConversionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConversionError::UnsupportedModel(model) => write!(f, "模型不支持: {}", model),
            ConversionError::EmptyMessages => write!(f, "消息列表为空"),
            ConversionError::Pdf(e) => write!(f, "{}", e),
        }
    }
}

impl std::error::Error for ConversionError {}

impl From<crate::anthropic::pdf::PdfError> for ConversionError {
    fn from(e: crate::anthropic::pdf::PdfError) -> Self {
        ConversionError::Pdf(e)
    }
}
```

- [ ] **Step 2: 引入 `PdfContext` 类型别名（converter 内部使用，便于后续 Task 8 串联）**

在 `src/anthropic/converter.rs` 顶部 use 列表新增：

```rust
use crate::anthropic::pdf::{DocumentCounter, PdfContext, process_pdf_block};
```

> `DocumentCounter` 需要在 mod.rs 中加 `pub` 导出，若 Task 6 已写为 `pub struct DocumentCounter`，无需补改。

- [ ] **Step 3: 扩展 `process_message_content` 签名 + `document` 分支**

把 `src/anthropic/converter.rs:343` 起的 `process_message_content` 改为：

```rust
/// 处理消息内容，提取文本、图片、PDF 文档和工具结果
fn process_message_content(
    content: &serde_json::Value,
    pdf_ctx: &PdfContext<'_>,
) -> Result<(String, Vec<KiroImage>, Vec<ToolResult>), ConversionError> {
    let mut text_parts = Vec::new();
    let mut images = Vec::new();
    let mut tool_results = Vec::new();
    let mut doc_counter = DocumentCounter::new();

    match content {
        serde_json::Value::String(s) => {
            text_parts.push(s.clone());
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                if let Ok(block) = serde_json::from_value::<ContentBlock>(item.clone()) {
                    match block.block_type.as_str() {
                        "text" => {
                            if let Some(text) = block.text {
                                text_parts.push(text);
                            }
                        }
                        "image" => {
                            if let Some(source) = block.source {
                                if let Some(format) = get_image_format(&source.media_type) {
                                    images.push(KiroImage::from_base64(format, source.data));
                                }
                            }
                        }
                        "document" => {
                            let wrapped = process_pdf_block(&block, &mut doc_counter, pdf_ctx)?;
                            text_parts.push(wrapped);
                        }
                        "tool_result" => {
                            if let Some(tool_use_id) = block.tool_use_id {
                                let result_content = extract_tool_result_content(&block.content);
                                let is_error = block.is_error.unwrap_or(false);

                                let mut result = if is_error {
                                    ToolResult::error(&tool_use_id, result_content)
                                } else {
                                    ToolResult::success(&tool_use_id, result_content)
                                };
                                result.status =
                                    Some(if is_error { "error" } else { "success" }.to_string());

                                tool_results.push(result);
                            }
                        }
                        "tool_use" => {}
                        _ => {}
                    }
                }
            }
        }
        _ => {}
    }

    Ok((text_parts.join("\n"), images, tool_results))
}
```

- [ ] **Step 4: 在测试模块中加 PDF 分发测试**

在 `src/anthropic/converter.rs` 末尾既有 `#[cfg(test)] mod tests` 内追加（如果文件没有该模块，则在末尾新增 `#[cfg(test)] mod pdf_dispatch_tests { ... }`）：

```rust
#[cfg(test)]
mod pdf_dispatch_tests {
    use super::*;
    use crate::anthropic::pdf::{PdfContext, PdfError, PdfTextExtractor};
    use crate::model::config::PdfConfig;

    struct StubExtractor(String);
    impl PdfTextExtractor for StubExtractor {
        fn extract_text(&self, _: &[u8]) -> Result<String, PdfError> {
            Ok(self.0.clone())
        }
    }

    fn run(content: serde_json::Value, extractor_text: &str) -> (String, Vec<KiroImage>) {
        let cfg = PdfConfig::default();
        let extractor = StubExtractor(extractor_text.to_string());
        let ctx = PdfContext { config: &cfg, extractor: &extractor };
        let (text, images, _) = process_message_content(&content, &ctx).unwrap();
        (text, images)
    }

    #[test]
    fn document_block_emits_wrapped_text() {
        let content = serde_json::json!([
            { "type": "text", "text": "前缀文本" },
            {
                "type": "document",
                "title": "a.pdf",
                "source": {
                    "type": "base64",
                    "media_type": "application/pdf",
                    "data": "JVBERi0K"
                }
            }
        ]);
        let (text, _) = run(content, "PDF 内容样例");
        assert!(text.contains("前缀文本"));
        assert!(text.contains("<document index=\"1\">"));
        assert!(text.contains("<source>a.pdf</source>"));
        assert!(text.contains("PDF 内容样例"));
    }

    #[test]
    fn multiple_document_blocks_get_sequential_index() {
        let content = serde_json::json!([
            {
                "type": "document",
                "source": { "type": "base64", "media_type": "application/pdf", "data": "JVBERi0K" }
            },
            {
                "type": "document",
                "source": { "type": "base64", "media_type": "application/pdf", "data": "JVBERi0K" }
            }
        ]);
        let (text, _) = run(content, "x");
        assert!(text.contains("index=\"1\""));
        assert!(text.contains("index=\"2\""));
    }

    #[test]
    fn unsupported_document_source_propagates_error() {
        let content = serde_json::json!([
            {
                "type": "document",
                "source": { "type": "url", "media_type": "application/pdf", "data": "https://x" }
            }
        ]);
        let cfg = PdfConfig::default();
        let extractor = StubExtractor("x".into());
        let ctx = PdfContext { config: &cfg, extractor: &extractor };
        let err = process_message_content(&content, &ctx).unwrap_err();
        assert!(matches!(err, ConversionError::Pdf(PdfError::UnsupportedSource(_))));
    }
}
```

- [ ] **Step 5: 跑新测试（此时 `merge_user_messages` 与 `convert_request` 会编译失败——这是预期，由 Task 8 修复）**

> 本 step 仅验证 dispatch 逻辑的语法/类型；编译错误集中在调用 `process_message_content` 的旧位置。Task 8 的 Step 1 会一次性修好。如果想在本 task 内独立验证，临时把所有 `process_message_content(&...)` 的调用点加 `, &todo_pdf_ctx()`，但不要 commit；Task 8 会替换为正确实现。

为了让本 Task 独立 commit，做法：把"调用点改造"也并入本 Task。下一 step 完成。

- [ ] **Step 6: 把 `process_message_content` 的旧调用点改为接收 ctx 参数（搬到 Task 8 完成）**

将"调用点改造"全部留到 Task 8。本 task 暂不 commit，跳到 Task 8 一起 commit。

> 例外：如果你希望本 task 也能单独编译通过，那就把 Task 8 的 Step 1 内联到这里——两种顺序都可以，**最终必须保证一次 commit 后 cargo build 成功**，不要留半态。

- [ ] **Step 7: （选项 A）如果选择"合并到 Task 8 一起 commit"**

跳到 Task 8。

- [ ] **Step 7: （选项 B）如果选择"现在就让本 task 编译通过"**

执行 Task 8 的 Step 1（修改 `convert_request` / `merge_user_messages` 签名），然后再回来：

```bash
cargo build
cargo test -p kiro-rs --lib pdf_dispatch_tests
```

Expected: 编译成功；3 个 dispatch 测试 PASS。

```bash
git add src/anthropic/converter.rs
git commit -m "feat(converter): 加 ConversionError::Pdf 与 document 分支分发"
```

> 推荐选 B：每个 commit 都让 build 绿。

---

### Task 8: `convert_request` / `merge_user_messages` 接入 `PdfContext`

**Files:**
- Modify: `src/anthropic/converter.rs`

- [ ] **Step 1: 修改 `convert_request` 签名**

把 `src/anthropic/converter.rs:220` 起的 `convert_request` 改为：

```rust
pub fn convert_request(
    req: &MessagesRequest,
    pdf_ctx: &PdfContext<'_>,
) -> Result<ConversionResult, ConversionError> {
    // ... 原内部实现保持，把所有 process_message_content(...) 改成 process_message_content(..., pdf_ctx)
    // 把所有 build_history(req, &messages, &model_id, ...) 改成 build_history(req, &messages, &model_id, ..., pdf_ctx)
    // 把所有 merge_user_messages(...) 改成 merge_user_messages(..., pdf_ctx)
}
```

具体细节：

1. 在函数体内，凡是调用 `process_message_content(content)` 的位置，都改成 `process_message_content(content, pdf_ctx)`。
2. 调用 `build_history(...)` 的位置，传入 `pdf_ctx`。

- [ ] **Step 2: 修改 `build_history` 与 `merge_user_messages` 签名（约 `src/anthropic/converter.rs:652` 和 `:752`）**

```rust
fn build_history(
    req: &MessagesRequest,
    messages: &[super::types::Message],
    model_id: &str,
    tool_name_map: &mut HashMap<String, String>,
    pdf_ctx: &PdfContext<'_>,
) -> Result<Vec<Message>, ConversionError> {
    // 原实现内部调用 merge_user_messages 处传入 pdf_ctx
}

fn merge_user_messages(
    messages: &[&super::types::Message],
    model_id: &str,
    pdf_ctx: &PdfContext<'_>,
) -> Result<HistoryUserMessage, ConversionError> {
    // 原实现内部 process_message_content 处传入 pdf_ctx
}
```

- [ ] **Step 3: 修改 converter 内部既有 `#[cfg(test)] mod tests` 中所有 `convert_request(&req)` 调用**

把 `convert_request(&req)` 替换为：

```rust
fn test_pdf_ctx() -> (crate::model::config::PdfConfig, crate::anthropic::pdf::PdfExtractExtractor) {
    (crate::model::config::PdfConfig::default(), crate::anthropic::pdf::PdfExtractExtractor)
}

// 调用方式：
let (cfg, extractor) = test_pdf_ctx();
let ctx = crate::anthropic::pdf::PdfContext { config: &cfg, extractor: &extractor };
let result = convert_request(&req, &ctx).unwrap();
```

为减少改造重复，建议在测试模块顶部加一个 helper：

```rust
fn convert_request_default(req: &MessagesRequest) -> Result<ConversionResult, ConversionError> {
    let cfg = crate::model::config::PdfConfig::default();
    let extractor = crate::anthropic::pdf::PdfExtractExtractor;
    let ctx = crate::anthropic::pdf::PdfContext { config: &cfg, extractor: &extractor };
    convert_request(req, &ctx)
}
```

然后把测试中的 `convert_request(&req)` 全数替换为 `convert_request_default(&req)`。

- [ ] **Step 4: 让 `pdf_dispatch_tests` 也用同一 helper 维持一致性**

无需改动，`process_message_content(...)` 已直接传 ctx。

- [ ] **Step 5: 编译并跑全部 lib 测试**

Run:

```bash
cargo build
cargo test -p kiro-rs --lib
```

Expected: 编译通过；converter 模块全部既有测试 + Task 7 新增的 `pdf_dispatch_tests` 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/anthropic/converter.rs
git commit -m "feat(converter): convert_request 接入 PdfContext"
```

---

### Task 9: `AppState` 注入 extractor + handler 4xx 映射

**Files:**
- Modify: `src/anthropic/middleware.rs`
- Modify: `src/anthropic/handlers.rs`
- Modify: `src/anthropic/router.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: 扩展 `AppState`**

把 `src/anthropic/middleware.rs:20` 起的 `AppState` 改为：

```rust
use std::sync::Arc;

use crate::anthropic::pdf::{PdfExtractExtractor, PdfTextExtractor};
use crate::model::config::PdfConfig;

#[derive(Clone)]
pub struct AppState {
    pub api_key: String,
    pub kiro_provider: Option<Arc<KiroProvider>>,
    pub extract_thinking: bool,
    pub pdf_config: Arc<PdfConfig>,
    pub pdf_extractor: Arc<dyn PdfTextExtractor>,
}

impl AppState {
    pub fn new(api_key: impl Into<String>, extract_thinking: bool) -> Self {
        Self {
            api_key: api_key.into(),
            kiro_provider: None,
            extract_thinking,
            pdf_config: Arc::new(PdfConfig::default()),
            pdf_extractor: Arc::new(PdfExtractExtractor),
        }
    }

    pub fn with_kiro_provider(mut self, provider: KiroProvider) -> Self {
        self.kiro_provider = Some(Arc::new(provider));
        self
    }

    pub fn with_pdf_config(mut self, cfg: PdfConfig) -> Self {
        self.pdf_config = Arc::new(cfg);
        self
    }

    pub fn with_pdf_extractor(mut self, extractor: Arc<dyn PdfTextExtractor>) -> Self {
        self.pdf_extractor = extractor;
        self
    }
}
```

- [ ] **Step 2: 在 `handlers.rs` 中加 PdfContext 构造 + 错误映射**

读 `src/anthropic/handlers.rs:24` 起的 `use` 列表与 `convert_request` 调用点（约 `:242` 和 `:791`），做 3 处改造：

(a) 在 `use super::converter::...` 行旁新增：

```rust
use super::pdf::{PdfContext, PdfError};
```

(b) 在 `convert_request(&payload)` 处改为：

```rust
let pdf_ctx = PdfContext {
    config: &state.pdf_config,
    extractor: state.pdf_extractor.as_ref(),
};
let conversion_result = match convert_request(&payload, &pdf_ctx) {
```

(c) 在错误匹配 `match &e { ... }` 内新增 `Pdf` 分支：

```rust
ConversionError::Pdf(pdf_err) => (
    "invalid_request_error",
    pdf_err.to_string(),
),
```

完整 match 块改为（替换 `:246` 起的整段）：

```rust
let conversion_result = match convert_request(&payload, &pdf_ctx) {
    Ok(result) => result,
    Err(e) => {
        let (error_type, message) = match &e {
            ConversionError::UnsupportedModel(model) => {
                ("invalid_request_error", format!("模型不支持: {}", model))
            }
            ConversionError::EmptyMessages => {
                ("invalid_request_error", "消息列表为空".to_string())
            }
            ConversionError::Pdf(pdf_err) => {
                ("invalid_request_error", pdf_err.to_string())
            }
        };
        tracing::warn!("请求转换失败: {}", e);
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(error_type, message)),
        )
            .into_response();
    }
};
```

(d) 同样的 3 处改造也应用到第二个调用点（约 `:791`，`post_messages_cc`）。

- [ ] **Step 3: 修改 `router.rs` 让其传入 `pdf_config` 与 extractor**

把 `src/anthropic/router.rs:36` 起的 `create_router_with_provider` 改为：

```rust
pub fn create_router_with_provider(
    api_key: impl Into<String>,
    kiro_provider: Option<KiroProvider>,
    extract_thinking: bool,
    pdf_config: crate::model::config::PdfConfig,
) -> Router {
    let mut state = AppState::new(api_key, extract_thinking).with_pdf_config(pdf_config);
    if let Some(provider) = kiro_provider {
        state = state.with_kiro_provider(provider);
    }
    // 其余保持原样
    ...
}
```

- [ ] **Step 4: 修改 `src/main.rs` 调用点**

把 `src/main.rs:161` 起的调用改为：

```rust
let anthropic_app = anthropic::create_router_with_provider(
    &api_key,
    Some(kiro_provider),
    config.extract_thinking,
    config.pdf.clone(),
);
```

- [ ] **Step 5: 编译验证**

Run:

```bash
cargo build
```

Expected: 成功。如果 `Arc<dyn PdfTextExtractor>` 在某处推断不出 `Sized`，把 `with_pdf_extractor` 的参数注释或 `Send + Sync` bound 与 trait 对齐确认（trait 已声明 `Send + Sync`）。

- [ ] **Step 6: 现有 lib 测试不应回归**

Run:

```bash
cargo test -p kiro-rs --lib
```

Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add src/anthropic/middleware.rs src/anthropic/handlers.rs src/anthropic/router.rs src/main.rs
git commit -m "feat(http): AppState 注入 PDF extractor，handler 映射 4xx"
```

---

### Task 10: extractor 调用包 `spawn_blocking` + `catch_unwind`

**Files:**
- Modify: `src/anthropic/pdf/extractor.rs`
- Test: 内联

- [ ] **Step 1: 把 panic 兜住**

在 `src/anthropic/pdf/extractor.rs::PdfExtractExtractor::extract_text` 中改为：

```rust
impl PdfTextExtractor for PdfExtractExtractor {
    fn extract_text(&self, pdf_bytes: &[u8]) -> Result<String, PdfError> {
        let bytes = pdf_bytes.to_vec();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            pdf_extract::extract_text_from_mem(&bytes)
        }));
        match result {
            Ok(Ok(text)) => Ok(text),
            Ok(Err(e)) => Err(PdfError::ParseFailed(e.to_string())),
            Err(_panic_payload) => Err(PdfError::ParseFailed(
                "panic during extraction".to_string(),
            )),
        }
    }
}
```

- [ ] **Step 2: 在 handler 中用 `spawn_blocking` 包裹同步调用**

> 因为 `process_pdf_block` 是同步函数，且 converter 也是同步的，最简单的做法是：让 handler 把整个 `convert_request` 用 `tokio::task::spawn_blocking` 包起来。但这会改动较大。**最小改动**做法：在 `convert_request` 之前不做这步——`pdf-extract` 处理 32 MB 内 PDF 通常 < 1 秒，单连接阻塞可接受。
>
> 折中：如果你愿意接收稍大改动，把 handler 中的 `convert_request` 调用改为：
>
> ```rust
> let payload_clone = payload.clone();
> let state_clone = state.clone();
> let conversion_result = tokio::task::spawn_blocking(move || {
>     let pdf_ctx = PdfContext {
>         config: &state_clone.pdf_config,
>         extractor: state_clone.pdf_extractor.as_ref(),
>     };
>     convert_request(&payload_clone, &pdf_ctx)
> })
> .await
> .map_err(|e| anyhow::anyhow!("convert_request join error: {e}"))??;
> ```
>
> **本 task 选择最小改动方案**：仅做 panic 兜底，不做 spawn_blocking 包裹。理由：spec §10 提及 spawn_blocking 但 §13 实施顺序的 #7 是可选项；32MB 上限下抽取耗时通常小于 1s，加上 axum runtime 是多线程，单请求阻塞影响可控。如果生产观察到延迟问题再补。

- [ ] **Step 3: 跑既有测试确认不破坏**

Run:

```bash
cargo test -p kiro-rs anthropic::pdf
```

Expected: 全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add src/anthropic/pdf/extractor.rs
git commit -m "feat(pdf): 用 catch_unwind 兜住 pdf-extract panic"
```

---

### Task 11: converter 端到端集成测试

**Files:**
- Create: `tests/pdf_converter.rs`

- [ ] **Step 1: 写端到端测试**

```rust
//! convert_request 端到端 PDF 测试
//!
//! 使用 tests/fixtures/pdf/simple_text.pdf 作为输入，验证：
//! - PDF 文本最终出现在 UserInputMessage.content 中
//! - 不影响其它字段

use base64::{Engine, engine::general_purpose::STANDARD};
use kiro_rs::anthropic::converter::convert_request;
use kiro_rs::anthropic::pdf::{PdfContext, PdfExtractExtractor};
use kiro_rs::anthropic::types::{Message, MessagesRequest};
use kiro_rs::model::config::PdfConfig;

fn fixture(name: &str) -> Vec<u8> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/pdf")
        .join(name);
    std::fs::read(&path).expect("fixture missing")
}

fn build_request_with_pdf(b64: &str, title: Option<&str>) -> MessagesRequest {
    // 构造一个最小可解析的 Anthropic 请求
    let title_part = title
        .map(|t| format!(",\"title\":\"{}\"", t))
        .unwrap_or_default();
    let raw = format!(
        r#"{{
            "model": "claude-sonnet-4-6",
            "max_tokens": 256,
            "stream": false,
            "messages": [
                {{
                    "role": "user",
                    "content": [
                        {{ "type": "text", "text": "请总结这份 PDF" }},
                        {{
                            "type": "document"{title_part},
                            "source": {{
                                "type": "base64",
                                "media_type": "application/pdf",
                                "data": "{b64}"
                            }}
                        }}
                    ]
                }}
            ]
        }}"#,
        title_part = title_part,
        b64 = b64
    );
    serde_json::from_str(&raw).expect("请求 JSON 必须可解析")
}

fn run(req: &MessagesRequest) -> kiro_rs::anthropic::converter::ConversionResult {
    let cfg = PdfConfig::default();
    let extractor = PdfExtractExtractor;
    let ctx = PdfContext { config: &cfg, extractor: &extractor };
    convert_request(req, &ctx).expect("转换应成功")
}

#[test]
fn simple_pdf_text_appears_in_user_input_content() {
    let bytes = fixture("simple_text.pdf");
    let b64 = STANDARD.encode(&bytes);
    let req = build_request_with_pdf(&b64, Some("simple.pdf"));
    let result = run(&req);

    let content = &result
        .conversation
        .current_message
        .user_input_message
        .content;

    assert!(content.contains("请总结这份 PDF"), "原 text 应保留");
    assert!(
        content.contains("<document index=\"1\">"),
        "应有 document 包裹标签：{}",
        content
    );
    assert!(
        content.contains("<source>simple.pdf</source>"),
        "应使用客户端给的 title：{}",
        content
    );
    assert!(
        content.contains("Hello PDF"),
        "应包含 PDF 文本内容：{}",
        content
    );
}

#[test]
fn empty_pdf_returns_pdf_error() {
    let bytes = fixture("scanned.pdf");
    let b64 = STANDARD.encode(&bytes);
    let req = build_request_with_pdf(&b64, None);

    let cfg = PdfConfig::default();
    let extractor = PdfExtractExtractor;
    let ctx = PdfContext { config: &cfg, extractor: &extractor };
    let err = convert_request(&req, &ctx).unwrap_err();

    use kiro_rs::anthropic::converter::ConversionError;
    use kiro_rs::anthropic::pdf::PdfError;
    assert!(
        matches!(err, ConversionError::Pdf(PdfError::EmptyText)),
        "扫描件应返回 EmptyText：{:?}",
        err
    );
}

#[test]
fn corrupt_pdf_returns_parse_failed() {
    let bytes = fixture("corrupt.pdf");
    let b64 = STANDARD.encode(&bytes);
    let req = build_request_with_pdf(&b64, None);

    let cfg = PdfConfig::default();
    let extractor = PdfExtractExtractor;
    let ctx = PdfContext { config: &cfg, extractor: &extractor };
    let err = convert_request(&req, &ctx).unwrap_err();

    use kiro_rs::anthropic::converter::ConversionError;
    use kiro_rs::anthropic::pdf::PdfError;
    assert!(
        matches!(err, ConversionError::Pdf(PdfError::ParseFailed(_))),
        "损坏 PDF 应返回 ParseFailed：{:?}",
        err
    );
}

#[test]
fn disabled_config_returns_disabled() {
    let bytes = fixture("simple_text.pdf");
    let b64 = STANDARD.encode(&bytes);
    let req = build_request_with_pdf(&b64, None);

    let mut cfg = PdfConfig::default();
    cfg.enabled = false;
    let extractor = PdfExtractExtractor;
    let ctx = PdfContext { config: &cfg, extractor: &extractor };
    let err = convert_request(&req, &ctx).unwrap_err();

    use kiro_rs::anthropic::converter::ConversionError;
    use kiro_rs::anthropic::pdf::PdfError;
    assert!(matches!(err, ConversionError::Pdf(PdfError::Disabled)));
}

#[test]
fn too_large_returns_too_large() {
    let bytes = fixture("simple_text.pdf");
    let b64 = STANDARD.encode(&bytes);
    let req = build_request_with_pdf(&b64, None);

    let mut cfg = PdfConfig::default();
    cfg.max_bytes = 10; // 强制超限
    let extractor = PdfExtractExtractor;
    let ctx = PdfContext { config: &cfg, extractor: &extractor };
    let err = convert_request(&req, &ctx).unwrap_err();

    use kiro_rs::anthropic::converter::ConversionError;
    use kiro_rs::anthropic::pdf::PdfError;
    assert!(matches!(err, ConversionError::Pdf(PdfError::TooLarge { .. })));
}
```

> 注：访问 `result.conversation.current_message.user_input_message.content` 需要 `ConversionResult` 中的字段是 `pub` 且嵌套结构 `pub`。如果发现不可见，将 `kiro_rs::anthropic::converter::ConversionResult` 与相关字段标记为 `pub`（这些原本就是 crate 公开 API）。先 `cargo build --tests` 检查可见性。

- [ ] **Step 2: 跑测试**

Run:

```bash
cargo test --test pdf_converter
```

Expected: 5 个 PASS。如失败：
- `Hello PDF` 未匹配：`pdf-extract` 抽取出的字符串可能是 `H e l l o   P D F`（pdf-extract 在某些版本会按字符间隙插空格）。改为 `assert!(content.contains("Hello") && content.contains("PDF"))`。
- 字段不可见：补 `pub`。

- [ ] **Step 3: Commit**

```bash
git add tests/pdf_converter.rs
git commit -m "test(pdf): convert_request 端到端集成测试"
```

---

### Task 12: README 增加 "PDF 支持" 小节

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 在 "功能特性" 列表加一行**

在 `README.md` "功能特性" 列表内（"Thinking 模式" 同级），插入：

```markdown
- **PDF 支持**: 反代识别 Anthropic `document` content block（base64 PDF），抽取文本后注入消息内容
```

- [ ] **Step 2: 在 "API 端点" 之后新增 "PDF 支持" 小节**

在 README 合适位置（建议放在 "工具调用" 之后、"模型映射" 之前）追加：

````markdown
## PDF 支持

反代支持 Anthropic 标准的 `document` content block（仅 base64 来源）。客户端按以下格式发送 PDF：

```json
{
  "type": "document",
  "title": "report.pdf",
  "source": {
    "type": "base64",
    "media_type": "application/pdf",
    "data": "<base64-encoded PDF bytes>"
  }
}
```

反代会把 PDF 抽取为纯文本，用 `<document index="N">` 包裹后注入发往上游的消息：

```text
<document index="1">
<source>report.pdf</source>
<document_content>
（抽取出的 PDF 文本）
</document_content>
</document>
```

### 限制

- 仅支持 `source.type = "base64"`（不支持 `url` 与 `file_id`）
- 仅支持 `media_type = "application/pdf"`
- 单 PDF 解码后字节上限：32 MB（可配置 `pdf.maxBytes`）
- 单 PDF 抽取文本字符上限：500,000（可配置 `pdf.maxTextChars`）
- 不支持扫描件 PDF（无文本，会返回 `document_empty_text` 错误）
- 不支持加密 PDF（会返回 `document_parse_failed` 错误）

### 错误码

所有 PDF 相关错误均返回 HTTP 400，错误 message 前缀如下：

| 前缀 | 含义 |
|---|---|
| `document_disabled` | `pdf.enabled = false` |
| `document_unsupported_source` | source.type 不是 base64 |
| `document_unsupported_media_type` | media_type 不是 application/pdf |
| `document_missing_source` | source 字段缺失 |
| `document_invalid_base64` | base64 解码失败 |
| `document_too_large` | 解码后字节超限 |
| `document_parse_failed` | PDF 解析失败（加密/损坏） |
| `document_empty_text` | 抽取文本为空（扫描件） |
| `document_text_too_large` | 抽取文本字符超限 |

### 配置

`config.json` 中可选段：

```json
{
  "pdf": {
    "enabled": true,
    "maxBytes": 33554432,
    "maxTextChars": 500000
  }
}
```

不配置时使用上述默认值。
````

- [ ] **Step 2: 验证**

```bash
# 简单的 markdown 自检：确保没有破坏既有 anchor
grep -n "^## " README.md | head -20
```

Expected: 输出包含新增的 `## PDF 支持` 行，且既有标题无丢失。

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): 新增 PDF 支持说明"
```

---

## 验收（执行完所有 task 后）

- [ ] **End-to-end build + tests**

```bash
cargo build --release
cargo test --all
```

Expected: 退出码 0；所有内联与集成测试 PASS。

- [ ] **手工验证（curl）**

启动反代后，用一份小 PDF 试验：

```bash
B64=$(base64 < tests/fixtures/pdf/simple_text.pdf)
curl -X POST http://127.0.0.1:8990/v1/messages \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"claude-sonnet-4-6\",
    \"max_tokens\": 200,
    \"stream\": false,
    \"messages\": [{
      \"role\": \"user\",
      \"content\": [
        {\"type\":\"text\",\"text\":\"用一句话总结这份 PDF\"},
        {\"type\":\"document\",\"source\":{\"type\":\"base64\",\"media_type\":\"application/pdf\",\"data\":\"$B64\"}}
      ]
    }]
  }"
```

Expected: 模型返回的总结涉及 "Hello PDF" 等 fixture 中的内容。

- [ ] **手工验证（扫描件）**：发送 `tests/fixtures/pdf/scanned.pdf`，预期 HTTP 400 + `document_empty_text`。
- [ ] **手工验证（关闭 PDF）**：把 `config.json` 中 `pdf.enabled` 设 false 重启，发送 PDF，预期 400 + `document_disabled`。
- [ ] **手工验证（无 PDF 流量回归）**：发送一个不含 `document` block 的普通请求，行为与改动前一致。

---

## Self-Review 结果

- **Spec coverage**：spec §2/3/4/5/6/7/8/9/10/11/13 各节均映射到对应 Task；§12 风险已在 Task 10 缓解（panic 兜底）+ spawn_blocking 决策记录。
- **Placeholder scan**：无 TBD/TODO；保留的"验证项"（pdf-extract 版本、`extract_text_from_mem` 名称、`Hello PDF` 抽取后空格）是真实的运行时分歧点而非占位符。
- **Type consistency**：
  - `PdfContext { config: &PdfConfig, extractor: &dyn PdfTextExtractor }` 在 mod.rs / converter.rs / handlers.rs 一致。
  - `DocumentCounter` 在 mod.rs 定义，在 converter.rs 引用——两处签名一致。
  - `PdfError` 9 个变体名称在 error.rs / mod.rs / handlers.rs / 集成测试中保持一致。
  - `BlockSource` / `ImageSource` 别名关系在 Task 5 锁定。
- **路径一致性**：fixture 路径 `tests/fixtures/pdf/*` 在 Task 4/11 间一致。





