from pydantic import BaseModel, Field, model_validator
from datetime import datetime
from .db import StoreType, UserRole


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: UserRole
    must_change_password: bool


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=8)


class RequestRecoveryCode(BaseModel):
    email: str


class RecoverAccount(BaseModel):
    email: str
    code: str
    new_password: str = Field(min_length=8)


class UserCreate(BaseModel):
    email: str
    name: str | None = None
    store_id: str


class UserUpdate(BaseModel):
    email: str | None = None
    name: str | None = None
    role: UserRole | None = None
    store_id: str | None = None
    is_active: bool | None = None


class UserResponse(BaseModel):
    id: str
    email: str
    name: str | None
    role: UserRole
    store_id: str | None
    is_active: bool
    must_change_password: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class StoreCreate(BaseModel):
    link: str | None = None
    phone_number: int | None = None
    town: str
    street: str
    street_number: str
    latitude: float
    longitude: float
    name: str
    description: str | None = None
    image_url: str | None = None
    is_active: bool = True
    store_type: StoreType
    opening_minute_mon: int = Field(ge=0, lt=1440)
    working_minutes_mon: int = Field(ge=0)
    opening_minute_tue: int = Field(ge=0, lt=1440)
    working_minutes_tue: int = Field(ge=0)
    opening_minute_wed: int = Field(ge=0, lt=1440)
    working_minutes_wed: int = Field(ge=0)
    opening_minute_thu: int = Field(ge=0, lt=1440)
    working_minutes_thu: int = Field(ge=0)
    opening_minute_fri: int = Field(ge=0, lt=1440)
    working_minutes_fri: int = Field(ge=0)
    opening_minute_sat: int = Field(ge=0, lt=1440)
    working_minutes_sat: int = Field(ge=0)
    opening_minute_sun: int = Field(ge=0, lt=1440)
    working_minutes_sun: int = Field(ge=0)


class StoreUpdate(BaseModel):
    link: str | None = None
    phone_number: int | None = None
    town: str | None = None
    street: str | None = None
    street_number: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    name: str | None = None
    description: str | None = None
    image_url: str | None = None
    is_active: bool | None = None
    store_type: StoreType | None = None
    opening_minute_mon: int | None = Field(default=None, ge=0, lt=1440)
    working_minutes_mon: int | None = Field(default=None, ge=0)
    opening_minute_tue: int | None = Field(default=None, ge=0, lt=1440)
    working_minutes_tue: int | None = Field(default=None, ge=0)
    opening_minute_wed: int | None = Field(default=None, ge=0, lt=1440)
    working_minutes_wed: int | None = Field(default=None, ge=0)
    opening_minute_thu: int | None = Field(default=None, ge=0, lt=1440)
    working_minutes_thu: int | None = Field(default=None, ge=0)
    opening_minute_fri: int | None = Field(default=None, ge=0, lt=1440)
    working_minutes_fri: int | None = Field(default=None, ge=0)
    opening_minute_sat: int | None = Field(default=None, ge=0, lt=1440)
    working_minutes_sat: int | None = Field(default=None, ge=0)
    opening_minute_sun: int | None = Field(default=None, ge=0, lt=1440)
    working_minutes_sun: int | None = Field(default=None, ge=0)


class ProductCreate(BaseModel):
    store_id: str
    amount: int | None = Field(default=None, ge=1)
    old_price: float | None = Field(default=None, ge=0)
    new_price: float | None = Field(default=None, ge=0)
    name: str
    description: str | None = None
    image_url: str | None = None
    expiration_date: datetime | None = None

    @model_validator(mode="after")
    def _check_product_prices(self) -> "ProductCreate":
        if self.old_price is not None and self.new_price is not None and self.old_price < self.new_price:
            raise ValueError("old_price must be greater than or equal to new_price")
        return self


class ProductUpdate(BaseModel):
    store_id: str | None = None
    amount: int | None = Field(default=None, ge=1)
    old_price: float | None = Field(default=None, ge=0)
    new_price: float | None = Field(default=None, ge=0)
    name: str | None = None
    description: str | None = None
    image_url: str | None = None
    is_active: bool | None = None
    expiration_date: datetime | None = None

    @model_validator(mode="after")
    def _check_product_prices(self) -> "ProductUpdate":
        if self.old_price is not None and self.new_price is not None and self.old_price < self.new_price:
            raise ValueError("old_price must be greater than or equal to new_price")
        return self


class StoreResponse(BaseModel):
    id : str
    link : str | None
    phone_number : int | None
    town : str
    street : str
    street_number : str
    latitude : float
    longitude : float
    name : str
    description : str | None
    image_url : str | None = None
    is_active : bool
    store_type : StoreType
    opening_minute_mon: int
    working_minutes_mon: int
    opening_minute_tue: int
    working_minutes_tue: int
    opening_minute_wed: int
    working_minutes_wed: int
    opening_minute_thu: int
    working_minutes_thu: int
    opening_minute_fri: int
    working_minutes_fri: int
    opening_minute_sat: int
    working_minutes_sat: int
    opening_minute_sun: int
    working_minutes_sun: int

    model_config = {"from_attributes": True}

class StoreMinimalResponse(BaseModel):
    id : str
    town : str
    street : str
    street_number : str
    latitude : float
    longitude : float
    name : str
    store_type : StoreType
    image_url: str | None = None
    today_products_count: int = Field(default=0, ge=0)
    today_opening_minute: int
    today_closing_minute: int

    model_config = {"from_attributes": True}


class ProductResponse(BaseModel):
    id: str
    store_id: str
    amount: int | None = Field(default=None, ge=1)
    old_price: float | None = Field(default=None, ge=0)
    new_price: float | None = Field(default=None, ge=0)
    name: str
    description: str | None
    image_url: str | None = None
    is_active: bool
    expiration_date: datetime | None
    creation_date: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="after")
    def _check_product_constraints(self) -> "ProductResponse":
        if self.old_price is not None and self.new_price is not None and self.old_price < self.new_price:
            raise ValueError("old_price must be greater than or equal to new_price")
        if self.expiration_date is not None and self.expiration_date < self.creation_date:
            raise ValueError("expiration_date must be greater than or equal to creation_date")
        return self

class ProductMinimalResponse(BaseModel):
    id: str
    amount: int | None = Field(default=None, ge=1)
    old_price: float | None = Field(default=None, ge=0)
    new_price: float | None = Field(default=None, ge=0)
    name: str
    image_url: str | None = None
    creation_date: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="after")
    def _check_price_constraints(self) -> "ProductMinimalResponse":
        if self.old_price is not None and self.new_price is not None and self.old_price < self.new_price:
            raise ValueError("old_price must be greater than or equal to new_price")
        return self


class ProductSearchResult(BaseModel):
    product_id: str
    product_name: str
    amount: int | None = Field(default=None, ge=1)
    old_price: float | None = Field(default=None, ge=0)
    new_price: float | None = Field(default=None, ge=0)
    image_url: str | None = None
    store_id: str
    store_name: str
    town: str
    street: str
    street_number: str
    latitude: float
    longitude: float
    distance_km: float | None = None

    model_config = {"from_attributes": True}
