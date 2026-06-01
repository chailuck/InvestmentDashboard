"""Auth request/response schemas."""

from pydantic import BaseModel, EmailStr, field_validator


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: "UserResponse"


class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    role: str
    avatar: str | None = None
    createdAt: str


TokenResponse.model_rebuild()


class UserUpdateRequest(BaseModel):
    """Schema for self-service profile update (name only).
    Users cannot elevate their own role or alter account status via this endpoint.
    """

    name: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name cannot be blank")
        if len(v) > 100:
            raise ValueError("Name must be 100 characters or fewer")
        return v
