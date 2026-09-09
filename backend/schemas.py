from pydantic import BaseModel, Field, model_validator
from datetime import datetime
from .db import StoreType


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
    closing_minute_mon: int
    opening_minute_tue: int
    closing_minute_tue: int
    opening_minute_wed: int
    closing_minute_wed: int
    opening_minute_thu: int
    closing_minute_thu: int
    opening_minute_fri: int
    closing_minute_fri: int
    opening_minute_sat: int
    closing_minute_sat: int
    opening_minute_sun: int
    closing_minute_sun: int

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
    today_products_count: int = Field(default=0, ge=0)
    today_opening_minute: int
    today_closing_minute: int

    model_config = {"from_attributes": True}


class ProductResponse(BaseModel):
    id: str
    store_id: str
    amount: int | None = Field(default=None, ge=1)
    old_price: float = Field(ge=0)
    new_price: float = Field(ge=0)
    name: str
    description: str | None
    image_url: str | None = None
    is_active: bool
    expiration_date: datetime | None
    creation_date: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="after")
    def _check_product_constraints(self) -> "ProductResponse":
        if self.old_price < self.new_price:
            raise ValueError("old_price must be greater than or equal to new_price")
        if self.expiration_date is not None and self.expiration_date < self.creation_date:
            raise ValueError("expiration_date must be greater than or equal to creation_date")
        return self

class ProductMinimalResponse(BaseModel):
    id: str
    amount: int | None = Field(default=None, ge=1)
    old_price: float = Field(ge=0)
    new_price: float = Field(ge=0)
    name: str
    creation_date: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="after")
    def _check_price_constraints(self) -> "ProductMinimalResponse":
        if self.old_price < self.new_price:
            raise ValueError("old_price must be greater than or equal to new_price")
        return self


class ProductSearchResult(BaseModel):
    product_id: str
    product_name: str
    amount: int | None = Field(default=None, ge=1)
    old_price: float = Field(ge=0)
    new_price: float = Field(ge=0)
    store_id: str
    store_name: str
    town: str
    street: str
    street_number: str
    latitude: float
    longitude: float
    distance_km: float | None = None

    model_config = {"from_attributes": True}
