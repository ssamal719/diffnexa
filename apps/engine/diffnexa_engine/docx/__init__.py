"""DOCX Compare: reading and comparing Microsoft Word .docx documents.

A Word document is read, safely and entirely in memory, into the same kind of
structured content nodes Website Change Detector uses — headings, paragraphs,
list items, table cells and links — and compared with the same proven layers.
Every change carries evidence that is checked against the documents it came
from before it is returned.
"""

from diffnexa_engine.docx.errors import DOCX_MESSAGES, DocxError, DocxErrorCode
from diffnexa_engine.docx.extract import extract_docx
from diffnexa_engine.docx.model import DocxDocument, DocxNode, DocxProperties
from diffnexa_engine.docx.package import DocxLimits

__all__ = [
    "DOCX_MESSAGES",
    "DocxDocument",
    "DocxError",
    "DocxErrorCode",
    "DocxLimits",
    "DocxNode",
    "DocxProperties",
    "extract_docx",
]
