//! PDF 处理过程中的错误类型

use std::fmt;

/// PDF 处理错误
#[derive(Debug)]
// 当前是 binary crate（无 lib.rs），后续 task 接通 converter 与 handler 之前
// dead_code lint 会对 PdfError / code() 报警告。Task 4 改造为 lib + bin 后可移除。
#[allow(dead_code)]
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
    TooLarge { bytes: u64, limit: u64 },
    /// `pdf-extract` 解析失败（加密 / 损坏 / 内部 panic）
    ParseFailed(String),
    /// 抽取出的文本为空（典型扫描件）
    EmptyText,
    /// 抽取文本字符数超过 `pdf.max_text_chars`
    TextTooLarge { chars: u64, limit: u64 },
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
