//! PDF 文本提取器
//!
//! `PdfTextExtractor` 是反代内部"PDF 字节 → 文本"的唯一抽象，
//! 默认实现 `PdfExtractExtractor` 基于 `pdf-extract` crate。
//! 未来若要替换为 `lopdf` / `mupdf` / OCR，仅需新增实现并替换注入。

use super::error::PdfError;

/// PDF 文本提取器
// binary-only crate 下 handler 层尚未接入，Task 4+ 接通后可移除
#[allow(dead_code)]
pub trait PdfTextExtractor: Send + Sync {
    /// 从 PDF 字节抽取纯文本。失败时返回 `PdfError::ParseFailed`。
    fn extract_text(&self, pdf_bytes: &[u8]) -> Result<String, PdfError>;
}

/// 基于 `pdf-extract` crate 的默认实现
// binary-only crate 下 handler 层尚未接入，Task 4+ 接通后可移除
#[allow(dead_code)]
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
