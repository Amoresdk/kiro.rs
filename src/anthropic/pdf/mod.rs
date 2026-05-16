//! PDF 处理模块
//!
//! 把 Anthropic `document` content block 抽取为纯文本，
//! 用于注入 Kiro `UserInputMessage.content`。

pub mod error;
pub mod extractor;

// 当前是 binary crate（无 lib.rs），后续 task 接通 converter 与 handler 之前
// unused_imports lint 会对这些 re-export 报警告。Task 4 改造为 lib + bin 后可移除。
#[allow(unused_imports)]
pub use error::PdfError;
#[allow(unused_imports)]
pub use extractor::{PdfExtractExtractor, PdfTextExtractor};
