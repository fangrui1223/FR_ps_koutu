from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class ServiceError(Exception):
    code: str
    message: str
    http_status: int = 400
    retryable: bool = False
    details: dict[str, Any] | None = None

    def __str__(self) -> str:
        return self.message

    def response(self, request_id: str | None = None) -> dict[str, Any]:
        error: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
        }
        if self.details:
            error["details"] = self.details
        return {"status": "error", "requestId": request_id, "error": error}
