//! 生成 tests/fixtures/pdf/ 下的 PDF 测试 fixture。
//!
//! 运行方式：
//!   cargo run --example gen_pdf_fixtures
//!
//! 依赖：dev-dep 中的 pdf-writer（无外部 CLI 工具）。

use pdf_writer::{Content, Finish, Name, Pdf, Rect, Ref, Str};
use std::path::PathBuf;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("pdf")
}

/// 构造单页含指定文本的最小 PDF
fn make_single_page_pdf(text: &[u8]) -> Vec<u8> {
    let mut pdf = Pdf::new();

    let catalog_id = Ref::new(1);
    let page_tree_id = Ref::new(2);
    let page_id = Ref::new(3);
    let font_id = Ref::new(4);
    let content_id = Ref::new(5);

    pdf.catalog(catalog_id).pages(page_tree_id);
    pdf.pages(page_tree_id).kids([page_id]).count(1);

    let mut page = pdf.page(page_id);
    page.media_box(Rect::new(0.0, 0.0, 595.0, 842.0));
    page.parent(page_tree_id);
    page.contents(content_id);
    page.resources().fonts().pair(Name(b"F1"), font_id);
    page.finish();

    pdf.type1_font(font_id).base_font(Name(b"Helvetica"));

    let mut content = Content::new();
    content.begin_text();
    content.set_font(Name(b"F1"), 14.0);
    content.next_line(50.0, 750.0);
    content.show(Str(text));
    content.end_text();
    pdf.stream(content_id, &content.finish());

    pdf.finish()
}

/// 构造两页 PDF，第一页含 marker_a，第二页含 marker_b
fn make_two_page_pdf(marker_a: &[u8], marker_b: &[u8]) -> Vec<u8> {
    let mut pdf = Pdf::new();

    let catalog_id = Ref::new(1);
    let page_tree_id = Ref::new(2);
    let page1_id = Ref::new(3);
    let page2_id = Ref::new(4);
    let font_id = Ref::new(5);
    let content1_id = Ref::new(6);
    let content2_id = Ref::new(7);

    pdf.catalog(catalog_id).pages(page_tree_id);
    pdf.pages(page_tree_id)
        .kids([page1_id, page2_id])
        .count(2);

    // 第一页
    let mut page1 = pdf.page(page1_id);
    page1.media_box(Rect::new(0.0, 0.0, 595.0, 842.0));
    page1.parent(page_tree_id);
    page1.contents(content1_id);
    page1.resources().fonts().pair(Name(b"F1"), font_id);
    page1.finish();

    // 第二页
    let mut page2 = pdf.page(page2_id);
    page2.media_box(Rect::new(0.0, 0.0, 595.0, 842.0));
    page2.parent(page_tree_id);
    page2.contents(content2_id);
    page2.resources().fonts().pair(Name(b"F1"), font_id);
    page2.finish();

    pdf.type1_font(font_id).base_font(Name(b"Helvetica"));

    // 第一页内容
    let mut c1 = Content::new();
    c1.begin_text();
    c1.set_font(Name(b"F1"), 14.0);
    c1.next_line(50.0, 750.0);
    c1.show(Str(marker_a));
    c1.end_text();
    pdf.stream(content1_id, &c1.finish());

    // 第二页内容
    let mut c2 = Content::new();
    c2.begin_text();
    c2.set_font(Name(b"F1"), 14.0);
    c2.next_line(50.0, 750.0);
    c2.show(Str(marker_b));
    c2.end_text();
    pdf.stream(content2_id, &c2.finish());

    pdf.finish()
}

/// 构造无文字内容的"扫描件"PDF（只有图形，无文本流）
fn make_scanned_pdf() -> Vec<u8> {
    let mut pdf = Pdf::new();

    let catalog_id = Ref::new(1);
    let page_tree_id = Ref::new(2);
    let page_id = Ref::new(3);
    let content_id = Ref::new(4);

    pdf.catalog(catalog_id).pages(page_tree_id);
    pdf.pages(page_tree_id).kids([page_id]).count(1);

    let mut page = pdf.page(page_id);
    page.media_box(Rect::new(0.0, 0.0, 595.0, 842.0));
    page.parent(page_tree_id);
    page.contents(content_id);
    // 不注册字体资源
    page.finish();

    // 只画一个矩形，不写任何文字
    let mut content = Content::new();
    content.save_state();
    content.set_fill_rgb(0.8, 0.8, 0.8);
    content.rect(50.0, 50.0, 495.0, 742.0);
    content.fill_nonzero();
    content.restore_state();
    pdf.stream(content_id, &content.finish());

    pdf.finish()
}

fn main() {
    let dir = fixtures_dir();
    std::fs::create_dir_all(&dir).expect("无法创建 fixture 目录");

    // 1. simple_text.pdf — 单页含 "Hello PDF"
    let simple = make_single_page_pdf(b"Hello PDF");
    let path = dir.join("simple_text.pdf");
    std::fs::write(&path, &simple).expect("写入 simple_text.pdf 失败");
    println!("生成 {} ({} bytes)", path.display(), simple.len());

    // 2. multi_page.pdf — 两页，第一页 AAA，第二页 BBB
    let multi = make_two_page_pdf(b"AAA Page One", b"BBB Page Two");
    let path = dir.join("multi_page.pdf");
    std::fs::write(&path, &multi).expect("写入 multi_page.pdf 失败");
    println!("生成 {} ({} bytes)", path.display(), multi.len());

    // 3. scanned.pdf — 无文字，只有图形
    let scanned = make_scanned_pdf();
    let path = dir.join("scanned.pdf");
    std::fs::write(&path, &scanned).expect("写入 scanned.pdf 失败");
    println!("生成 {} ({} bytes)", path.display(), scanned.len());

    // 4. corrupt.pdf — 故意损坏的字节序列
    let corrupt = b"%PDF-1.4\nthis is intentionally corrupted bytes for kiro-rs tests\n%%EOF\n";
    let path = dir.join("corrupt.pdf");
    std::fs::write(&path, corrupt).expect("写入 corrupt.pdf 失败");
    println!("生成 {} ({} bytes)", path.display(), corrupt.len());

    println!("\n所有 fixture 已生成到 {}", dir.display());
    println!("注意：encrypted.pdf 未生成（需要 lopdf 加密支持），对应测试已标记 #[ignore]");
}
