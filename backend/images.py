from __future__ import annotations

import os
from pathlib import Path
from random import choice

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

IMAGEKIT_URL_ENDPOINT = os.getenv("IMAGEKIT_URL_ENDPOINT", "").rstrip("/")

STORE_IMAGE_FILES = ["store_example1.JPG", "store_example2.jpg", "store_example3.webp"]
PRODUCT_IMAGE_FILES = ["product_example1.jpg", "product_example2.jpg", "product_example3.jpeg"]


def store_image_url() -> str | None:
    if not IMAGEKIT_URL_ENDPOINT:
        return None
    return f"{IMAGEKIT_URL_ENDPOINT}/{choice(STORE_IMAGE_FILES)}"


def product_image_url() -> str | None:
    if not IMAGEKIT_URL_ENDPOINT:
        return None
    return f"{IMAGEKIT_URL_ENDPOINT}/{choice(PRODUCT_IMAGE_FILES)}"