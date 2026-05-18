//! PDF 处理过程中的错误类型

use std::fmt;

// 错误码字符串常量（对外契约）。
// 客户端可按这些常量做错误分支匹配，而不是裸字符串硬编码。
pub const CODE_DISABLED: &str = "document_disabled";
pub const CODE_UNSUPPORTED_SOURCE: &str = "document_unsupported_source";
pub const CODE_UNSUPPORTED_MEDIA_TYPE: &str = "document_unsupported_media_type";
pub const CODE_MISSING_SOURCE: &str = "document_missing_source";
pub const CODE_INVALID_BASE64: &str = "document_invalid_base64";
pub const CODE_TOO_LARGE: &str = "document_too_large";
pub const CODE_PARSE_FAILED: &str = "document_parse_failed";
pub const CODE_EMPTY_TEXT: &str = "document_empty_text";
pub const CODE_TEXT_TOO_LARGE: &str = "document_text_too_large";

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
            PdfError::Disabled => CODE_DISABLED,
            PdfError::UnsupportedSource(_) => CODE_UNSUPPORTED_SOURCE,
            PdfError::UnsupportedMediaType(_) => CODE_UNSUPPORTED_MEDIA_TYPE,
            PdfError::MissingSource => CODE_MISSING_SOURCE,
            PdfError::InvalidBase64(_) => CODE_INVALID_BASE64,
            PdfError::TooLarge { .. } => CODE_TOO_LARGE,
            PdfError::ParseFailed(_) => CODE_PARSE_FAILED,
            PdfError::EmptyText => CODE_EMPTY_TEXT,
            PdfError::TextTooLarge { .. } => CODE_TEXT_TOO_LARGE,
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
        assert_eq!(PdfError::Disabled.code(), CODE_DISABLED);
        assert_eq!(
            PdfError::UnsupportedSource("url".into()).code(),
            CODE_UNSUPPORTED_SOURCE
        );
        assert_eq!(
            PdfError::UnsupportedMediaType("image/png".into()).code(),
            CODE_UNSUPPORTED_MEDIA_TYPE
        );
        assert_eq!(PdfError::MissingSource.code(), CODE_MISSING_SOURCE);
        assert_eq!(
            PdfError::InvalidBase64("bad".into()).code(),
            CODE_INVALID_BASE64
        );
        assert_eq!(
            PdfError::TooLarge { bytes: 100, limit: 50 }.code(),
            CODE_TOO_LARGE
        );
        assert_eq!(
            PdfError::ParseFailed("x".into()).code(),
            CODE_PARSE_FAILED
        );
        assert_eq!(PdfError::EmptyText.code(), CODE_EMPTY_TEXT);
        assert_eq!(
            PdfError::TextTooLarge { chars: 10, limit: 5 }.code(),
            CODE_TEXT_TOO_LARGE
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

    #[test]
    fn display_includes_dynamic_fields() {
        assert!(format!("{}", PdfError::UnsupportedSource("url".into())).contains("url"));
        assert!(format!("{}", PdfError::UnsupportedMediaType("image/png".into())).contains("image/png"));
        assert!(format!("{}", PdfError::InvalidBase64("padding".into())).contains("padding"));
        assert!(format!("{}", PdfError::ParseFailed("encrypted".into())).contains("encrypted"));
        let s = format!("{}", PdfError::TextTooLarge { chars: 999, limit: 100 });
        assert!(s.contains("999") && s.contains("100"));
    }
}
