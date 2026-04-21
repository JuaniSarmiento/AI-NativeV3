"""Autenticación y autorización."""
from academic_service.auth.dependencies import (
    User,
    get_current_user,
    get_db,
    require_role,
)
from academic_service.auth.casbin_setup import (
    check_permission,
    get_enforcer,
    require_permission,
)

__all__ = [
    "User",
    "get_current_user",
    "get_db",
    "require_role",
    "check_permission",
    "get_enforcer",
    "require_permission",
]
