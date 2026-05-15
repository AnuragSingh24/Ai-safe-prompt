from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass


@dataclass(frozen=True)
class CachedScan:
    masked_text: str
    risk: str
    detections: tuple
    detection_count: int
    action: str
    layers: tuple = ()


class ScanCache:
    def __init__(self, max_items: int = 128) -> None:
        self.max_items = max_items
        self._items: OrderedDict[str, CachedScan] = OrderedDict()

    def get(self, key: str) -> CachedScan | None:
        item = self._items.get(key)
        if item is None:
            return None
        self._items.move_to_end(key)
        return item

    def set(self, key: str, value: CachedScan) -> None:
        self._items[key] = value
        self._items.move_to_end(key)

        while len(self._items) > self.max_items:
            self._items.popitem(last=False)
