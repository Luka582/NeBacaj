from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DEFAULT_BACKEND_URL = os.getenv("ADMIN_BACKEND_URL", "http://localhost:8000").rstrip("/")


class BackendError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


class Backend:
    """Thin httpx client for the NeBacaj admin endpoints."""

    def __init__(self, base_url: str, token: str | None = None):
        self.base_url = base_url.rstrip("/")
        self.token = token

    def _headers(self) -> dict[str, str]:
        if self.token:
            return {"Authorization": f"Bearer {self.token}"}
        return {}

    def _request(self, method: str, path: str, parse_json: bool = True, **kwargs: Any) -> Any:
        try:
            response = httpx.request(method, f"{self.base_url}{path}", headers=self._headers(), timeout=120, **kwargs)
        except httpx.HTTPError as exc:
            raise BackendError(0, f"Cannot reach backend: {exc}") from exc
        if response.status_code >= 400:
            detail = response.text
            try:
                payload = response.json()
                raw = payload.get("detail", response.text)
                if isinstance(raw, list):
                    detail = "; ".join(
                        f"{item.get('loc', '')}: {item.get('msg', '')}" for item in raw if isinstance(item, dict)
                    ) or response.text
                elif isinstance(raw, str):
                    detail = raw
            except Exception:
                pass
            raise BackendError(response.status_code, detail)
        if not parse_json:
            return response.content
        if response.status_code == 204 or not response.content:
            return None
        return response.json()

    @staticmethod
    def _sniff_image_type(content: bytes, declared: str | None) -> str:
        if content[:8] == b"\x89PNG\r\n\x1a\n":
            return "image/png"
        if content[:3] == b"\xff\xd8\xff":
            return "image/jpeg"
        if content[:4] == b"GIF8":
            return "image/gif"
        if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
            return "image/webp"
        if declared and declared.startswith("image/"):
            return declared
        return "application/octet-stream"

    def _multipart(self, payload: dict[str, Any], image=None) -> dict[str, Any]:
        data_json = json.dumps(payload, ensure_ascii=False, default=str)
        form = {"data": data_json}
        if image is None:
            return {"data": form}
        file_name = getattr(image, "name", None) or "image"
        content = image.getvalue() if hasattr(image, "getvalue") else image.read()
        file_type = self._sniff_image_type(content, getattr(image, "type", None))
        return {"data": form, "files": {"image": (file_name, content, file_type)}}

    # --- auth -----------------------------------------------------------
    def login(self, email: str, password: str) -> dict:
        data = self._request("POST", "/auth/login", json={"email": email, "password": password})
        self.token = data["access_token"]
        return data

    def me(self) -> dict:
        return self._request("GET", "/auth/me")

    def change_password(self, old_password: str, new_password: str) -> dict:
        return self._request(
            "POST",
            "/auth/change-password",
            json={"old_password": old_password, "new_password": new_password},
        )

    # --- stores ---------------------------------------------------------
    def list_stores(self, is_active: bool = True) -> list[dict]:
        return self._request("GET", "/stores", params={"is_active": is_active, "only_opened": False})

    def get_store(self, store_id: str) -> dict:
        return self._request("GET", f"/store/{store_id}")

    def create_store(self, payload: dict[str, Any], image=None) -> dict:
        return self._request("POST", "/stores", **self._multipart(payload, image))

    def update_store(self, store_id: str, payload: dict[str, Any], image=None) -> dict:
        return self._request("PUT", f"/stores/{store_id}", **self._multipart(payload, image))

    def delete_store(self, store_id: str) -> None:
        self._request("DELETE", f"/stores/{store_id}")

    def update_announcement(self, store_id: str, payload: dict[str, Any], image=None) -> dict:
        return self._request("PUT", f"/stores/{store_id}/announcement", **self._multipart(payload, image))

    # --- products -------------------------------------------------------
    def list_products(self, store_id: str, is_active: bool = True) -> list[dict]:
        return self._request(
            "GET",
            f"/products/{store_id}",
            params={"is_active": is_active, "today_only": False},
        )

    def get_product(self, product_id: str) -> dict:
        return self._request("GET", f"/product/{product_id}")

    def create_product(self, payload: dict[str, Any], image=None) -> dict:
        return self._request("POST", "/products", **self._multipart(payload, image))

    def update_product(self, product_id: str, payload: dict[str, Any], image=None) -> dict:
        return self._request("PUT", f"/products/{product_id}", **self._multipart(payload, image))

    def delete_product(self, product_id: str) -> None:
        self._request("DELETE", f"/products/{product_id}")

    # --- workers --------------------------------------------------------
    def list_workers(self) -> list[dict]:
        return self._request("GET", "/workers")

    def create_worker(self, payload: dict[str, Any]) -> dict:
        return self._request("POST", "/workers", json=payload)

    def update_worker(self, worker_id: str, payload: dict[str, Any]) -> dict:
        return self._request("PUT", f"/workers/{worker_id}", json=payload)

    def reset_worker_password(self, worker_id: str) -> dict:
        return self._request("POST", f"/workers/{worker_id}/reset-password")

    def delete_worker(self, worker_id: str) -> None:
        self._request("DELETE", f"/workers/{worker_id}")

    # --- reports --------------------------------------------------------
    def list_reports(self, is_resolved: bool | None = None) -> list[dict]:
        params = {} if is_resolved is None else {"is_resolved": is_resolved}
        return self._request("GET", "/reports", params=params)

    def resolve_report(self, report_id: str) -> dict:
        return self._request("POST", f"/reports/{report_id}/resolve")

    def export_db(self) -> bytes:
        return self._request("GET", "/admin/export-db", parse_json=False)