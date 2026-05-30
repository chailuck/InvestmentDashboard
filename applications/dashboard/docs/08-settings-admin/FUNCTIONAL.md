# Settings & Admin — Functional Specification

---

## 1. Settings — My Profile (`/settings`)

Available to all authenticated users.

### 1.1 Profile Section

- **Name** — editable text field; saved via `PUT /api/v1/users/me`
- **Email** — read-only (contact admin to change)
- **Role** — read-only badge (`Admin` / `Analyst` / `Viewer`)

### 1.2 Change Password

Three fields: Current Password · New Password · Confirm New Password.  
Saved via `PUT /api/v1/users/me/password`. Requires current password to be correct.

### 1.3 App Configuration (all users)

Controls the paths used by the portfolio tracker:

| Field | Description |
|-------|-------------|
| **Source File Path** | Full container path to the read-only Excel source (e.g. `/app/investment_data/Investment tracking.xlsx`) |
| **Working Copy Path** | Full container path where the working copy is stored (e.g. `/app/uploads/investment_tracking.xlsx`) |

- **Test** button — verifies the source path is readable; shows success/error message
- Changes are saved to `/app/uploads/app_config.json` and take effect immediately for all subsequent portfolio reads

> **Path mapping note:** Paths are container-internal paths. The host directory is mapped via the Docker volume mount. To change the host directory, update `docker-compose.yml` and restart.

---

## 2. Admin — User Management (`/admin/users`)

Visible in sidebar only for `admin` role. Protected by `require_admin` on the backend.

### 2.1 User List

Table columns: Name · Email · Role · Status · Last Login · Actions

Actions per user:
- **Edit** — opens a modal to change name, role, and active status
- **Set Password** — force-set the user's password (admin only)
- **Delete** — hard-delete with confirmation (cannot delete yourself)

### 2.2 Create User

Button at the top opens a modal with:
- Name, Email, Role (`admin` / `analyst` / `viewer`)
- Password and Confirm Password

The new user is created active with the chosen role.

### 2.3 Self-Protection Rules

- Admin cannot change their own role or active status from this page
- Admin cannot delete themselves
- These are enforced both in the UI (buttons disabled) and on the backend

---

## 3. Documents (`/settings/documents`)

A documentation browser accessible to all authenticated users.

### 3.1 Tree Navigation

A left sidebar shows the documentation tree loaded from `GET /api/v1/docs-content/manifest`. Items expand/collapse. Clicking a leaf loads that document.

### 3.2 Content View

The selected document is rendered as formatted Markdown with syntax highlighting for code blocks, styled tables, and proper heading hierarchy.

### 3.3 Export

**Per page:**
- **Export MD** — downloads the current page as a `.md` file
- **Export HTML** — downloads the current page as a self-contained `.html` file (uses CDN-rendered markdown)

**Whole project:**
- **Export All (MD)** — fetches every document in the manifest tree, concatenates them with section headers, and downloads as one `.md` file
- **Export All (HTML)** — same but wrapped in a styled HTML file

The exported HTML file uses CDN resources (`marked.js` + `github-markdown-css`) so it renders correctly when opened in any browser.
