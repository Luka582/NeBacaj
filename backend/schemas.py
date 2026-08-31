from pydantic import BaseModel
from datetime import datetime
from .db import StoreType


class StoreResponse(BaseModel):
    id : str
    link : str | None
    town : str
    street : str
    street_number : str
    latitude : float
    longitude : float
    name : str
    description : str | None
    is_active : bool
    store_type : StoreType

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

    model_config = {"from_attributes": True}


class ProductResponse(BaseModel):
    id: str
    store_id: str
    amount: int | None
    old_price: float
    new_price: float
    name: str
    description: str | None
    is_active: bool
    expiration_date: datetime

    model_config = {"from_attributes": True}

class ProductMinimalResponse(BaseModel):
    id: str
    amount: int | None
    old_price: float
    new_price: float
    name: str
    expiration_date: datetime

    model_config = {"from_attributes": True}