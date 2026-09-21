from __future__ import annotations

import os
from pathlib import Path
from random import choice

from dotenv import load_dotenv
from imagekitio import AsyncImageKit

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

IMAGEKIT_URL_ENDPOINT = os.getenv("IMAGEKIT_URL_ENDPOINT", "").rstrip("/")
IMAGEKIT_PRIVATE_KEY = os.getenv("IMAGEKIT_PRIVATE_KEY", "")

STORE_IMAGE_FILES = ["store_example1.JPG", "store_example2.jpg", "store_example3.webp"]
PRODUCT_IMAGE_FILES = ["product_example1.jpg", "product_example2.jpg", "product_example3.jpeg"]

_client: AsyncImageKit | None = None


def _get_client() -> AsyncImageKit:
    global _client
    if not IMAGEKIT_PRIVATE_KEY:
        raise RuntimeError("IMAGEKIT_PRIVATE_KEY is not set")
    if _client is None:
        _client = AsyncImageKit(private_key=IMAGEKIT_PRIVATE_KEY)
    return _client


async def upload_image(data: bytes, file_name: str, folder: str, content_type: str) -> tuple[str, str]:
    """Upload bytes to ImageKit, returning (url, file_id)."""
    response = await _get_client().files.upload(
        file=(file_name, data, content_type),
        file_name=file_name,
        folder=folder,
        use_unique_file_name=False,
        overwrite_file=True,
    )
    if not response.url or not response.file_id:
        raise RuntimeError("ImageKit upload returned no url/file_id")
    return response.url, response.file_id


async def delete_image(file_id: str | None) -> None:
    """Best-effort delete of an ImageKit file by id."""
    if not file_id:
        return
    try:
        await _get_client().files.delete(file_id)
    except Exception:
        pass


def store_image_url() -> str | None:
    if not IMAGEKIT_URL_ENDPOINT:
        return None
    return f"{IMAGEKIT_URL_ENDPOINT}/{choice(STORE_IMAGE_FILES)}"


def product_image_url() -> str | None:
    if not IMAGEKIT_URL_ENDPOINT:
        return None
    return f"{IMAGEKIT_URL_ENDPOINT}/{choice(PRODUCT_IMAGE_FILES)}"