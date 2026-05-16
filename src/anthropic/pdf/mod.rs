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
    let approx_decoded = (source.data.len() as u64 / 4) * 3;
    if approx_decoded > ctx.config.max_bytes {
        return Err(PdfError::TooLarge {
            bytes: approx_decoded,
            limit: ctx.config.max_bytes,
        });
    }

    let bytes = STANDARD
        .decode(&source.data)
        .map_err(|e| PdfError::InvalidBase64(e.to_string()))?;

    let decoded_len = bytes.len() as u64;
    if decoded_len > ctx.config.max_bytes {
        return Err(PdfError::TooLarge {
            bytes: decoded_len,
            limit: ctx.config.max_bytes,
        });
    }

    let text = ctx.extractor.extract_text(&bytes)?;

    if text.trim().is_empty() {
        return Err(PdfError::EmptyText);
    }

    let chars = text.chars().count() as u64;
    if chars > ctx.config.max_text_chars {
        return Err(PdfError::TextTooLarge {
            chars,
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
