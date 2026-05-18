# PDF 测试 fixture

| 文件 | 用途 |
|---|---|
| simple_text.pdf | 单页含 "Hello PDF" 文本，验证抽取成功路径 |
| multi_page.pdf | 多页，每页含 marker AAA/BBB，验证多页连续抽取 |
| encrypted.pdf | （可选）加密 PDF，验证 ParseFailed 路径；fixture 缺失时对应测试 #[ignore] |
| scanned.pdf | 无文本仅图形，验证 EmptyText 路径 |
| corrupt.pdf | 故意损坏的字节序列，验证 ParseFailed 路径 |

## 重新生成

```bash
cargo run --example gen_pdf_fixtures
```

依赖：dev-dep 中的 pdf-writer（无外部 CLI 工具）。
