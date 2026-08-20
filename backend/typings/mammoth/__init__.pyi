from typing import BinaryIO

class Result:
    value: str
    messages: list[object]

def convert_to_html(fileobj: BinaryIO, *, style_map: str = ...) -> Result: ...
def extract_raw_text(fileobj: BinaryIO) -> Result: ...
