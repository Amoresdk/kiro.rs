//! convert_request 端到端 PDF 测试
//!
//! 使用 tests/fixtures/pdf/simple_text.pdf 等作为输入，验证：
//! - PDF 文本最终出现在 UserInputMessage.content 中
//! - 不影响其它字段
//! - 错误路径返回正确的 ConversionError::Pdf 变体

use base64::{Engine, engine::general_purpose::STANDARD};
use kiro_rs::anthropic::converter::{ConversionError, convert_request};
use kiro_rs::anthropic::pdf::{PdfContext, PdfError, PdfExtractExtractor};
use kiro_rs::anthropic::types::MessagesRequest;
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
        }}"#
    );
    serde_json::from_str(&raw).expect("请求 JSON 必须可解析")
}

fn run_with_default_cfg(req: &MessagesRequest) -> kiro_rs::anthropic::converter::ConversionResult {
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
    let result = run_with_default_cfg(&req);

    let content = &result
        .conversation_state
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
    // pdf-extract 在某些版本会按字符间隙插空格，做宽松断言
    let normalized = content.replace(' ', "");
    assert!(
        normalized.contains("HelloPDF") || content.contains("Hello PDF"),
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

    assert!(matches!(err, ConversionError::Pdf(PdfError::TooLarge { .. })));
}
