# Settings & Admin — Technical Design

---

## 1. App Configuration

### Storage

Configuration is persisted to `/app/uploads/app_config.json` (inside the backend container):

```json
{
  "excel_source_path": "/app/investment_data/Investment tracking.xlsx",
  "excel_working_path": "/app/uploads/investment_tracking.xlsx"
}
```

**File:** `backend/app/services/app_config_service.py`

```python
CONFIG_PATH = Path("/app/uploads/app_config.json")

def get_app_config() -> dict:
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text())
    return {}

def save_app_config(data: dict) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(data, indent=2))
```

### Endpoint

**File:** `backend/app/api/v1/endpoints/app_config.py`

```python
@router.get("/app-config")
async def get_config(_: UserId) -> dict:
    cfg = get_app_config()
    return { "excel_source_path": cfg.get("excel_source_path", settings.investment_excel_source_path),
             "excel_working_path": cfg.get("excel_working_path", settings.investment_excel_path) }

@router.put("/app-config")
async def save_config(body: AppConfigUpdate, _: UserId) -> dict:
    cfg = get_app_config()
    if body.excel_source_path: cfg["excel_source_path"] = body.excel_source_path
    if body.excel_working_path: cfg["excel_working_path"] = body.excel_working_path
    save_app_config(cfg)
    return {"status": "ok"}

@router.post("/app-config/test-path")
async def test_path(body: TestPathRequest, _: UserId) -> dict:
    p = Path(body.path)
    return { "exists": p.exists(), "readable": p.is_file() and os.access(p, os.R_OK),
             "size_kb": round(p.stat().st_size / 1024, 1) if p.exists() else None }
```

**Access:** All authenticated users (not admin-only). Previously admin-gated but changed so all users can configure the data source.

---

## 2. User Management

### Backend Endpoints

All in `backend/app/api/v1/endpoints/users.py`, protected by `require_admin`.

```python
GET  /users           → list all users (paginated)
POST /users           → create user with hashed password
GET  /users/{id}      → get single user
PUT  /users/{id}      → update name, role, is_active
DELETE /users/{id}    → hard delete (blocks self-delete)
PUT  /users/{id}/password    → admin force-set password
PUT  /users/me               → update own name (any user)
PUT  /users/me/password      → change own password (requires current)
```

Self-protection (backend-level):
```python
@router.delete("/users/{user_id}")
async def delete_user(user_id: uuid.UUID, current_user: User = Depends(require_admin)):
    if user_id == current_user.id:
        raise HTTPException(400, "Cannot delete yourself")
```

---

## 3. Documentation System

### Backend

**File:** `backend/app/api/v1/endpoints/docs_content.py`

Serves markdown files from `/app/docs/` (mounted read-only from `./docs` on the host).

```python
DOCS_DIR = Path("/app/docs")

@router.get("/manifest")
async def get_manifest(_: UserId) -> dict:
    manifest_path = DOCS_DIR / "manifest.json"
    if manifest_path.exists():
        return json.loads(manifest_path.read_text())
    return _DEFAULT_MANIFEST    # fallback if manifest.json missing

@router.get("/file")
async def get_file(_: UserId, path: str = Query(...)) -> dict:
    target = (DOCS_DIR / path).resolve()
    if not str(target).startswith(str(DOCS_DIR.resolve())):
        raise HTTPException(403)    # path traversal blocked
    return {"path": path, "content": target.read_text()}
```

### Frontend

**File:** `frontend/src/app/(dashboard)/settings/documents/page.tsx`

Components:
- `TreeNode` — recursive, renders leaf nodes as buttons and groups as collapsible accordions
- `useEffect` auto-selects first leaf on manifest load
- Content rendered with `react-markdown` + `remark-gfm`

### Export Logic

```typescript
// MD export (current page)
function exportCurrentMd(content: string, filename: string) {
  downloadBlob(content, `${filename}.md`, 'text/markdown')
}

// HTML export (current page) — grabs rendered DOM
function exportCurrentHtml(label: string) {
  const html = document.getElementById('doc-render')?.innerHTML ?? ''
  downloadBlob(wrapHtml(label, html), `${label}.html`, 'text/html')
}

// All pages MD export — fetch each leaf, concatenate
async function exportAllMd(manifest, fetch) {
  const sections = await gatherAllDocs(manifest, fetch)
  const combined = sections.map(s => `# ${s.label}\n\n${s.content}`).join('\n\n---\n\n')
  downloadBlob(combined, 'InvestPro-Documentation.md', 'text/markdown')
}

// HTML template (with CDN marked.js for rendering)
function wrapHtml(title: string, body: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title} — InvestPro Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5/github-markdown-dark.min.css">
  <style>body{background:#0d1117;padding:2rem}
    .markdown-body{max-width:900px;margin:0 auto;background:#161b22;padding:2rem;border-radius:8px}
  </style>
</head>
<body class="markdown-body">${body}</body>
</html>`
}
```

`downloadBlob` creates a temporary `<a>` element, sets its `href` to a `Blob` URL, clicks it, then revokes the URL.
