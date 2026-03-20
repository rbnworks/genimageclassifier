from datetime import datetime
from pydantic import BaseModel


class ImageItem(BaseModel):
    id: str
    path: str
    url: str
    prompt: str
    created_at: datetime


class PromptGroup(BaseModel):
    prompt_id: str
    prompt: str
    sample_image: ImageItem
    count: int


class PromptGroupSummary(BaseModel):
    prompt_id: str
    prompt: str
    sample_image_url: str
    count: int
    latest_updated_at: datetime
