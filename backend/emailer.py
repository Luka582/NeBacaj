from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587

SENDER_EMAIL = os.getenv("AUTO_REPLY_EMAIL", "")
SENDER_APP_PASSWORD = os.getenv("AUTO_REPLY_EMAIL_APP_PASSWORD", "")
SENDER_EMAIL_ALIAS = os.getenv("AUTO_REPLY_EMAIL_ALIAS", "")


def _send(subject: str, body: str, to_email: str) -> None:
    if not SENDER_EMAIL or not SENDER_APP_PASSWORD or not SENDER_EMAIL_ALIAS:
        return
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = f"NeBacaj <{SENDER_EMAIL_ALIAS}>"
    message["To"] = to_email
    message.set_content(body)
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
        server.starttls()
        server.login(SENDER_EMAIL, SENDER_APP_PASSWORD)
        server.send_message(message)


def send_temporary_password(email: str, temp_password: str) -> bool:
    if not SENDER_EMAIL or not SENDER_APP_PASSWORD or not SENDER_EMAIL_ALIAS:
        return False
    body = (
        "Pozdrav,\n\n"
        "Vaš nalog za NeBacaj je napravljen.\n"
        f"Adresa: {email}\n"
        f"Privremena lozinka: {temp_password}\n\n"
        "Prijavite se i promenite lozinku pri prvoj prijavi.\n\n"
        "— NeBacaj tim"
    )
    _send("Vaša NeBacaj lozinka", body, email)
    return True


def send_recovery_code(email: str, code: str, expires_minutes: int) -> bool:
    if not SENDER_EMAIL or not SENDER_APP_PASSWORD or not SENDER_EMAIL_ALIAS:
        return False
    body = (
        "Pozdrav,\n\n"
        "Zatražili ste obnovu lozinke za NeBacaj.\n"
        f"Vaš jednokratni kod: {code}\n\n"
        f"Kod važi {expires_minutes} minuta.\n"
        "Ako niste vi zatražili obnovu, ignorišite ovaj mejl.\n\n"
        "— NeBacaj tim"
    )
    _send("Vaš NeBacaj kod za obnovu lozinke", body, email)
    return True