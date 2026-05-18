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
    // pdf-extract 在某些版本会按字符间隙插空格，所以宽松断言
    let normalized = text.replace(' ', "");
    assert!(
        normalized.contains("HelloPDF") || text.contains("Hello PDF"),
        "抽取的文本应包含 'Hello PDF'，实际：{:?}",
        text
    );
}

#[test]
fn multi_page_pdf_contains_each_page_marker() {
    let bytes = load("multi_page.pdf");
    let text = PdfExtractExtractor.extract_text(&bytes).expect("应抽取成功");
    let normalized = text.replace(' ', "");
    assert!(
        normalized.contains("AAA"),
        "缺少第一页 marker：{:?}",
        text
    );
    assert!(
        normalized.contains("BBB"),
        "缺少第二页 marker：{:?}",
        text
    );
}

#[test]
#[ignore = "encrypted.pdf 生成需要 lopdf 加密支持，可选；运行：cargo test --test pdf_extractor -- --ignored"]
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
