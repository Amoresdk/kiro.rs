//! PDF 处理模块
//!
//! 把 Anthropic `document` content block 抽取为纯文本，
//! 用于注入 Kiro `UserInputMessage.content`。

pub mod error;
pub mod extractor;

#[allow(unused_imports)]
pub use error::PdfError;
