# Authentication — Functional Specification

---

## 1. Overview

InvestPro uses JWT-based authentication with short-lived access tokens and long-lived refresh tokens. All API calls require a Bearer token except for the auth endpoints themselves and health checks.

---

## 2. User Roles (RBAC)

| Role | Description | Permissions |
|------|-------------|-------------|
| `admin` | Full access | All endpoints; user management; can manage all users |
| `analyst` | Power user | All non-admin endpoints; can update own profile |
| `viewer` | Read-only | All non-admin endpoints; can update own profile |

**Role assignment:** Set by admin at user creation or via the Users management page.

---

## 3. Login

**Page:** `/login`

1. User enters email + password and clicks **Sign In**.
2. Frontend calls `POST /api/v1/auth/login`.
3. On success: stores `accessToken`, `refreshToken`, and user object in Zustand auth store (persisted to `sessionStorage`).
4. Redirects to `/dashboard`.
5. On failure: shows "Invalid credentials. Please try again." error message.

**Token lifetimes:**
- Access token: 30 minutes (configurable via `ACCESS_TOKEN_EXPIRE_MINUTES`)
- Refresh token: 7 days (configurable via `REFRESH_TOKEN_EXPIRE_DAYS`)

---

## 4. Silent Token Refresh

When an API call returns **401 Unauthorized**, the Axios interceptor in `frontend/src/services/api.ts` automatically:

1. Sends `POST /api/v1/auth/refresh` with the stored `refreshToken`.
2. On success: updates stored tokens and retries the original request.
3. On failure (refresh token expired/invalid): calls `clearAuth()` and redirects to `/login`.

This is transparent to the user — they stay logged in for up to 7 days without re-entering credentials.

---

## 5. Logout

- Clicking the Logout button (bottom of sidebar) calls `clearAuth()`.
- Auth state is cleared from Zustand + `sessionStorage`.
- The access token is blacklisted server-side via `POST /api/v1/auth/logout` (the token's JTI is stored in Redis until the token expires naturally).
- User is redirected to `/login`.

---

## 6. Forgot Password

**Page:** `/forgot-password`

1. User enters their email address.
2. Frontend calls `POST /api/v1/auth/forgot-password`.
3. Backend generates a reset token (UUID) and stores it in Redis with 1-hour TTL.
4. **Development mode:** the reset token is returned directly in the API response (`reset_token` field). Copy this token from the browser DevTools to use it.
5. **Production mode:** the token would normally be emailed (email sending is not yet implemented; the token is still returned in the response for now).

---

## 7. Password Reset

**Page:** `/reset-password?token=<token>`

1. The URL must contain the `?token=` query parameter (from the forgot-password response).
2. User enters a new password (minimum 8 characters).
3. Frontend calls `POST /api/v1/auth/reset-password`.
4. Backend validates the token against Redis, hashes the new password, updates the user.
5. On success: redirects to `/login` with a success message.
6. On failure (token expired or invalid): shows error message.

---

## 8. First-Run Admin Seeding

When the backend starts, if `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set in the environment, an admin account is seeded:

```sql
INSERT INTO users (id, email, name, hashed_password, role, is_active)
VALUES (uuid_generate_v4(), :email, :name, :pwd, 'admin', true)
ON CONFLICT (email) DO NOTHING;
```

The `ON CONFLICT DO NOTHING` makes this safe to run on every startup (all 4 workers).

---

## 9. Protected Routes (Frontend)

The dashboard layout (`frontend/src/app/(dashboard)/layout.tsx`) checks for auth state on mount. If not authenticated, it redirects to `/login`.

Role-based visibility is enforced in the sidebar — admin-only items are hidden from non-admins:

```typescript
SETTINGS_SUB.filter(item => !item.adminOnly || user?.role === 'admin')
```

The backend provides the second layer of enforcement via the `require_admin` FastAPI dependency.
