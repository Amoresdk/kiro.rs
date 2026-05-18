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
        // TODO(spawn_blocking): 当前在 handler 调用栈内同步执行 pdf-extract，
        // 32MB 上限的小 PDF 在常规负载下可接受；高并发或文本量大时建议
        // 用 tokio::task::spawn_blocking 包裹 extract_text 避免阻塞 axum worker。
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

    /// 验证 catch_unwind 真的捕获 panic（用一个会引发已知问题的输入）
    /// 注意：能让 pdf-extract 真正 panic 的输入难以稳定构造，
    /// 这里改用一个"几乎可达 panic 路径"的输入：极短/截断的 PDF 头。
    /// 实际 panic 取决于 pdf-extract 内部实现，这条测试主要确认：
    /// - 即使输入异常，extract_text 不会让进程崩溃
    /// - 返回 ParseFailed 而不是 unwrap panic
    #[test]
    fn malformed_input_does_not_panic_process() {
        let extractor = PdfExtractExtractor;
        let inputs: &[&[u8]] = &[
            b"%PDF-1.4\n",                  // 仅头部
            b"%PDF-1.4\n%%EOF",             // 头 + EOF 无内容
            &[0xFF; 64],                    // 全 0xFF
            &[0u8; 8],                      // 全零
        ];
        for input in inputs {
            let r = extractor.extract_text(input);
            // 不要求一定 ParseFailed，可能 Ok 空字符串也行；唯一不允许的是 panic 让测试进程崩溃。
            // catch_unwind 已确保即使 pdf-extract 内部 panic 也会回到 Err 而非 abort。
            let _ = r;
        }
    }
}
