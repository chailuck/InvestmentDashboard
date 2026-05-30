# Authentication — Technical Design

---

## 1. JWT Implementation

**File:** `backend/app/auth/jwt.py`

```python
from jose import jwt, JWTError
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def create_access_token(sub: str) -> str:
    expire = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({"sub": sub, "exp": expire, "type": "access"}, settings.app_secret_key, algorithm=settings.jwt_algorithm)

def create_refresh_token(sub: str) -> str:
    expire = datetime.now(UTC) + timedelta(days=settings.refresh_token_expire_days)
    return jwt.encode({"sub": sub, "exp": expire, "type": "refresh"}, settings.app_secret_key, algorithm=settings.jwt_algorithm)

def verify_token(token: str) -> dict:
    payload = jwt.decode(token, settings.app_secret_key, algorithms=[settings.jwt_algorithm])
    return payload   # raises JWTError on invalid/expired
```

**Algorithm:** HS256 (symmetric; the same `app_secret_key` signs and verifies)

**Dependency constraint:** `bcrypt==3.2.2` — passlib 1.7.4 is incompatible with bcrypt 4.x.

---

## 2. FastAPI Auth Dependencies

**File:** `backend/app/auth/dependencies.py`

```python
bearer_scheme = HTTPBearer(auto_error=False)

async def get_current_user_id(credentials: ...) -> str:
    payload = verify_token(credentials.credentials)
    return str(payload["sub"])          # returns user UUID as string

async def get_current_user(user_id: ..., db: ...) -> User:
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    # raises 404 if not found; 403 if inactive

async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin": raise 403

async def require_analyst(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in ("admin", "analyst"): raise 403
```

**Usage pattern in endpoints:**

```python
UserId = Annotated[str, Depends(get_current_user_id)]
CurrentUser = Annotated[User, Depends(get_current_user)]

@router.get("/positions")
async def list_positions(_: UserId) -> ...:
    # Just needs authentication, not the user object
```

---

## 3. Token Blacklist (Redis)

On logout, the token's JTI (JWT ID — a UUID embedded in every token) is stored in Redis with TTL equal to the remaining token lifetime.

```python
# On logout:
payload = verify_token(token)
jti = payload["jti"]
ttl = int(payload["exp"] - time.time())
await redis.setex(f"blacklist:{jti}", ttl, "1")

# On verify:
if await redis.exists(f"blacklist:{jti}"):
    raise HTTPException(401, "Token revoked")
```

---

## 4. Password Reset Flow (Redis)

```python
# forgot-password:
token = str(uuid.uuid4())
await redis.setex(f"pwd_reset:{token}", 3600, user_id)
return {"reset_token": token}   # dev mode — email not implemented yet

# reset-password:
user_id = await redis.get(f"pwd_reset:{token}")
if not user_id: raise 400 "Token invalid or expired"
user.hashed_password = hash_password(new_password)
await redis.delete(f"pwd_reset:{token}")
```

---

## 5. Frontend Auth Store

**File:** `frontend/src/store/auth.ts`

```typescript
interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  user: { id: string; email: string; name: string; role: string } | null
  setTokens: (data: { accessToken; refreshToken; user }) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setTokens: (data) => set(data),
      clearAuth: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    { name: 'auth-storage', storage: createJSONStorage(() => sessionStorage) }
  )
)
```

**Storage:** `sessionStorage` — clears automatically when the tab is closed.

---

## 6. Axios Interceptors

**File:** `frontend/src/services/api.ts`

```typescript
const BASE_URL = '/api/proxy'   // all calls go through Next.js proxy

export const apiClient = axios.create({ baseURL: `${BASE_URL}/api/v1` })

// Attach token to every request
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Auto-refresh on 401
apiClient.interceptors.response.use(
  res => res,
  async (error: AxiosError) => {
    const original = error.config as any
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      const { refreshToken, setTokens } = useAuthStore.getState()
      const { data } = await axios.post('/api/proxy/api/v1/auth/refresh', { refreshToken })
      setTokens(data)
      original.headers.Authorization = `Bearer ${data.accessToken}`
      return apiClient(original)     // retry original request
    }
    // If refresh fails, clearAuth() is called and user goes to /login
    useAuthStore.getState().clearAuth()
    return Promise.reject(error)
  }
)
```

---

## 7. Security Headers

Added by `SecurityHeadersMiddleware` (`backend/app/middleware/security.py`):

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
```

Each request also gets a unique `X-Request-Id` UUID for log correlation.
