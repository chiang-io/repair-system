# Repository Guidelines

## Project Structure & Module Organization

This workspace currently contains only `報修需求筆記.txt`, the requirements for a demonstration repair-reporting system. There is no application code, dependency manifest, test suite, or Git repository yet. Read the requirements before implementing features.

When implementation begins, organize application code in `src/`, tests in `tests/`, static assets in `public/`, and Supabase schema migrations and policies in `supabase/`. Keep supporting spreadsheets, presentations, and operating instructions in `docs/`. These directories are proposed conventions, not existing components.

## Build, Test, and Development Commands

No build, test, development, lint, or formatting commands are currently configured. Do not assume that `npm test` or `npm run build` works. When choosing a stack, document its installation, local development, build, and test commands in `README.md`, and commit the appropriate dependency manifest and lockfile.

## Coding Style & Naming Conventions

Follow the conventions of the selected language and formatter consistently. No indentation standard or linting tool has been established; configure these when adding code. Use descriptive names such as `RepairForm` and `RepairList`, and keep filenames consistent within each module. Preserve Traditional Chinese labels and the category, urgency, and status values specified in the requirements.

## Testing Guidelines

No testing framework or coverage threshold exists yet. Add behavior-focused tests alongside implementation, using the selected framework's standard naming convention. Cover required fields, report submission, list display, and automatically generated registration timestamps. Verify Supabase policies allow public inserts and reads while rejecting updates and deletes.

## Commit & Pull Request Guidelines

There is no Git history from which to infer commit conventions. After Git initialization, use concise imperative subjects, for example `Add repair submission form`. Pull requests should describe the change, reference relevant requirements or issues, record validation performed, and include screenshots for visible interface changes.

## Security & Scope

Use fictional names and locations in all demonstration data. Enable Supabase row-level security before exposing the public client key; never commit privileged service keys. The current demonstration covers submission and listing without login. Status updates, authentication, and notifications remain unresolved requirements; clarify their scope before implementation.

## 倉庫物品查詢（使用者為倉管）

使用者是倉管，會請你查「某樣東西在哪個倉」。這裡的「倉庫」指實體倉庫，不是 Git 倉庫。

- **重點欄位是「品名」和「編號」（產品編號）。**查詢、整理或比對資料時，一律以這兩欄為主，回答也要同時列出品名和編號。
- 使用者常用的倉別是 **02 新品倉** 和 **06 五金倉**。
- 資料來源是 ERP 印出的「存貨異動統計表-分倉」PDF，欄位有：倉別、產品編號、品名規格、結存數量、單重。報表沒有儲位，使用者之後會補上儲位資料。
- 數量會變動。回答數量時要註明報表日期；需要最新數量時，請使用者上傳最新報表。
- 有些長編號在 PDF 裡會和品名黏在一起（例如 `SB-BD425231873-1(輕)斜桿...`），解析時要拆開。
- 庫存資料屬於公司內部資料，未經使用者同意不要提交到倉庫。
