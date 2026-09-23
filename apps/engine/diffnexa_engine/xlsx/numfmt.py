"""Excel number formats: what kind of value a cell holds, and how it reads.

Excel stores every number — prices, percentages, dates — as a plain number. What
makes 46295 a date and 0.25 a percentage is the cell's number format. So a
number is treated as a date only when its format says so, never because of its
size, and a date written as text stays text.

`render` shows a number the way its format asks, for the common formats:
decimal places, thousands separators, currency symbols and text, percentages,
scientific notation, and date and time codes. It is a display aid: every
comparison is made on the stored value, not on this text. Formats it does not
understand (fractions, conditional sections) fall back to Excel's General
format, and a date whose format is Excel's locale-dependent "short date" is
shown as day, month name and year so that it cannot be misread.
"""

from __future__ import annotations

import datetime as dt
import math
import re
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

FormatKind = Literal["general", "number", "percent", "date", "time", "datetime", "text"]

# Excel's built-in formats that files refer to by number only.
BUILTIN_FORMATS: dict[int, str] = {
    0: "General",
    1: "0",
    2: "0.00",
    3: "#,##0",
    4: "#,##0.00",
    5: '"$"#,##0_);("$"#,##0)',
    6: '"$"#,##0_);[Red]("$"#,##0)',
    7: '"$"#,##0.00_);("$"#,##0.00)',
    8: '"$"#,##0.00_);[Red]("$"#,##0.00)',
    9: "0%",
    10: "0.00%",
    11: "0.00E+00",
    12: "# ?/?",
    13: "# ??/??",
    14: "mm-dd-yy",
    15: "d-mmm-yy",
    16: "d-mmm",
    17: "mmm-yy",
    18: "h:mm AM/PM",
    19: "h:mm:ss AM/PM",
    20: "h:mm",
    21: "h:mm:ss",
    22: "m/d/yy h:mm",
    37: "#,##0_);(#,##0)",
    38: "#,##0_);[Red](#,##0)",
    39: "#,##0.00_);(#,##0.00)",
    40: "#,##0.00_);[Red](#,##0.00)",
    41: '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)',
    42: '_("$"* #,##0_);_("$"* (#,##0);_("$"* "-"_);_(@_)',
    43: '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)',
    44: '_("$"* #,##0.00_)_("$"* (#,##0.00)_("$"* "-"??_)_(@_)',
    45: "mm:ss",
    46: "[h]:mm:ss",
    47: "mmss.0",
    48: "##0.0E+0",
    49: "@",
}

#: Built-in 14 is the locale's short date; Excel shows it differently in every
#: country, so it is shown unambiguously instead.
LOCALE_SHORT_DATE = 14
UNAMBIGUOUS_DATE = "d mmm yyyy"


def _strip_literals(code: str) -> str:
    """The format code without quoted text, escapes, padding, fills and brackets."""
    out: list[str] = []
    i = 0
    while i < len(code):
        ch = code[i]
        if ch == '"':
            end = code.find('"', i + 1)
            i = len(code) if end == -1 else end + 1
            continue
        if ch in "\\_*":
            i += 2
            continue
        if ch == "[":
            end = code.find("]", i + 1)
            inner = code[i + 1 : end] if end != -1 else ""
            # Elapsed-time tokens ([h], [mm], [ss]) are part of the format.
            if re.fullmatch(r"[hHmMsS]+", inner):
                out.append(inner)
            i = len(code) if end == -1 else end + 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _sections(code: str) -> list[str]:
    parts: list[str] = []
    current: list[str] = []
    quoted = False
    i = 0
    while i < len(code):
        ch = code[i]
        if ch == '"':
            quoted = not quoted
        elif ch == "\\" and not quoted and i + 1 < len(code):
            current.append(code[i : i + 2])
            i += 2
            continue
        elif ch == ";" and not quoted:
            parts.append("".join(current))
            current = []
            i += 1
            continue
        current.append(ch)
        i += 1
    parts.append("".join(current))
    return parts


def classify(code: str) -> FormatKind:
    """What kind of value a format presents. Only the first section decides."""
    if not code or code.strip().lower() == "general":
        return "general"
    first = _strip_literals(_sections(code)[0])
    lowered = first.lower().replace("general", "").replace("am/pm", "").replace("a/p", "")
    if lowered.strip() == "@":
        return "text"
    has_date = bool(re.search(r"[dy]", lowered)) or ("m" in lowered and not re.search(r"[hs]", lowered))
    has_time = bool(re.search(r"[hs]", lowered))
    if has_date and has_time:
        return "datetime"
    if has_date:
        return "date"
    if has_time:
        return "time"
    if "%" in first:
        return "percent"
    return "number"


# ---------------------------------------------------------------- dates


def serial_to_datetime(serial: float, date1904: bool) -> dt.datetime | None:
    """An Excel date serial as a date and time, or None if it is out of range.

    The 1900 system counts 1 January 1900 as day 1 and — copying an old Lotus
    bug — includes a 29 February 1900 that never existed (day 60). Serials from
    day 61 onwards are therefore one day ahead of a plain count.
    """
    if not math.isfinite(serial) or serial < 0 or serial > 2_958_465:  # 31 December 9999
        return None
    days = math.floor(serial)
    seconds = round((serial - days) * 86_400)
    if seconds == 86_400:
        days, seconds = days + 1, 0
    if date1904:
        base = dt.datetime(1904, 1, 1)
    elif days >= 61:
        base = dt.datetime(1899, 12, 30)
    elif days == 60:
        return None  # the non-existent 29 February 1900
    elif days == 0:
        base = dt.datetime(1899, 12, 31)  # Excel shows day 0 as "0 January 1900"
    else:
        base = dt.datetime(1899, 12, 31)
    return base + dt.timedelta(days=days, seconds=seconds)


_MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]
_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

_DATE_TOKEN = re.compile(
    r"yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|\[h+\]|hh|h|ss|s|am/pm|a/p|\.0+",
    re.IGNORECASE,
)


def _render_date(code: str, value: dt.datetime, serial: float) -> str:
    tokens: list[tuple[str, str]] = []  # ("tok"|"lit", text)
    i = 0
    while i < len(code):
        ch = code[i]
        if ch == '"':
            end = code.find('"', i + 1)
            end = len(code) if end == -1 else end
            tokens.append(("lit", code[i + 1 : end]))
            i = end + 1
            continue
        if ch == "\\" and i + 1 < len(code):
            tokens.append(("lit", code[i + 1]))
            i += 2
            continue
        if ch in "_*":
            i += 2
            continue
        if ch == "[" and not re.match(r"\[h+\]", code[i:], re.IGNORECASE):
            end = code.find("]", i + 1)
            i = len(code) if end == -1 else end + 1
            continue
        match = _DATE_TOKEN.match(code, i)
        if match:
            tokens.append(("tok", match.group(0)))
            i = match.end()
            continue
        tokens.append(("lit", ch))
        i += 1

    twelve_hour = any(kind == "tok" and text.lower() in ("am/pm", "a/p") for kind, text in tokens)
    out: list[str] = []
    for index, (kind, text) in enumerate(tokens):
        if kind == "lit":
            out.append(text)
            continue
        low = text.lower()
        if low in ("m", "mm"):
            # "m" means minutes right after an hour or right before seconds.
            before = next((t.lower() for k, t in reversed(tokens[:index]) if k == "tok"), "")
            after = next((t.lower() for k, t in tokens[index + 1 :] if k == "tok"), "")
            if before.startswith(("h", "[h")) or after.startswith("s"):
                out.append(f"{value.minute:02d}" if low == "mm" else str(value.minute))
                continue
            out.append(f"{value.month:02d}" if low == "mm" else str(value.month))
        elif low == "mmm":
            out.append(_MONTHS[value.month - 1][:3])
        elif low == "mmmm":
            out.append(_MONTHS[value.month - 1])
        elif low == "mmmmm":
            out.append(_MONTHS[value.month - 1][0])
        elif low == "yyyy":
            out.append(f"{value.year:04d}")
        elif low == "yy":
            out.append(f"{value.year % 100:02d}")
        elif low == "d":
            out.append(str(value.day))
        elif low == "dd":
            out.append(f"{value.day:02d}")
        elif low == "ddd":
            out.append(_DAYS[value.weekday()][:3])
        elif low == "dddd":
            out.append(_DAYS[value.weekday()])
        elif low.startswith("[h"):
            out.append(str(int(serial * 24)))
        elif low in ("h", "hh"):
            hour = (value.hour % 12 or 12) if twelve_hour else value.hour
            out.append(f"{hour:02d}" if low == "hh" else str(hour))
        elif low == "s":
            out.append(str(value.second))
        elif low == "ss":
            out.append(f"{value.second:02d}")
        elif low == "am/pm":
            out.append("AM" if value.hour < 12 else "PM")
        elif low == "a/p":
            out.append("A" if value.hour < 12 else "P")
        elif low.startswith("."):
            out.append("." + "0" * (len(low) - 1))
    return "".join(out)


# ---------------------------------------------------------------- numbers


def general(number: Decimal) -> str:
    """Excel's General format: up to 11 significant digits, no grouping."""
    if number == number.to_integral_value() and abs(number) < Decimal("1e11"):
        return str(int(number))
    value = float(number)
    text = f"{value:.10g}" if abs(value) >= 1e-9 or value == 0 else f"{value:.5E}"
    if "e" in text:
        mantissa, exponent = text.split("e")
        sign = "-" if exponent.startswith("-") else "+"
        text = f"{mantissa}E{sign}{abs(int(exponent)):02d}"
    return text


def _literal_and_pattern(section: str) -> tuple[str, str, str]:
    """Split one section into text before the number, the digit pattern, and text after."""
    pieces: list[tuple[str, str]] = []
    i = 0
    while i < len(section):
        ch = section[i]
        if ch == '"':
            end = section.find('"', i + 1)
            end = len(section) if end == -1 else end
            pieces.append(("lit", section[i + 1 : end]))
            i = end + 1
        elif ch == "\\" and i + 1 < len(section):
            pieces.append(("lit", section[i + 1]))
            i += 2
        elif ch in "_*":
            i += 2  # alignment padding and fill characters take no visible text here
        elif ch == "[":
            end = section.find("]", i + 1)
            inner = section[i + 1 : end] if end != -1 else ""
            if inner.startswith("$"):
                symbol = inner[1:].split("-", 1)[0]
                if symbol:
                    pieces.append(("lit", symbol))
            i = len(section) if end == -1 else end + 1
        elif ch in "0#?.,%" or (ch in "Ee" and i + 1 < len(section) and section[i + 1] in "+-"):
            if ch in "Ee":
                pieces.append(("pat", section[i : i + 2]))
                i += 2
            else:
                pieces.append(("pat", ch))
                i += 1
        else:
            pieces.append(("lit", ch))
            i += 1
    pattern_positions = [index for index, (kind, _) in enumerate(pieces) if kind == "pat"]
    if not pattern_positions:
        return "".join(text for _, text in pieces), "", ""
    first, last = pattern_positions[0], pattern_positions[-1]
    before = "".join(text for kind, text in pieces[:first] if kind == "lit")
    pattern = "".join(text for kind, text in pieces[first : last + 1] if kind == "pat")
    after = "".join(text for kind, text in pieces[last + 1 :] if kind == "lit")
    return before, pattern, after


def _format_digits(number: Decimal, pattern: str) -> str:
    percent = pattern.count("%")
    number = number * (Decimal(100) ** percent)
    core = pattern.replace("%", "")
    # Commas right after the last digit placeholder divide by 1,000 each.
    scale = len(core) - len(core.rstrip(","))
    core = core.rstrip(",")
    number = number / (Decimal(1000) ** scale)

    if "E" in core.upper():
        mantissa_pattern, exponent_pattern = re.split(r"[Ee][+-]", core, maxsplit=1)
        decimals = len(mantissa_pattern.split(".", 1)[1]) if "." in mantissa_pattern else 0
        if number == 0:
            exponent = 0
        else:
            exponent = math.floor(math.log10(abs(float(number))))
        mantissa = number / (Decimal(10) ** exponent)
        mantissa_text = f"{abs(mantissa):.{decimals}f}"
        if mantissa_text.startswith("10"):
            exponent += 1
            mantissa_text = f"{abs(number / (Decimal(10) ** exponent)):.{decimals}f}"
        sign = "-" if exponent < 0 else "+"
        return f"{mantissa_text}E{sign}{abs(exponent):0{len(exponent_pattern)}d}" + "%" * percent

    integer_part, _, fraction_part = core.partition(".")
    required = fraction_part.count("0")
    optional = len(fraction_part) - required
    places = required + optional
    rounded = abs(number).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
    text = f"{rounded:.{places}f}"
    whole, _, fraction = text.partition(".")
    if optional and fraction:
        trimmed = fraction.rstrip("0")
        fraction = trimmed.ljust(required, "0")
    min_integer = integer_part.count("0")
    if whole == "0" and min_integer == 0:
        whole = ""
    whole = whole.rjust(min_integer, "0")
    if "," in integer_part and whole:
        whole = f"{int(whole):,}"
    result = whole + ("." + fraction if fraction or (places and required) else "")
    if not result:
        result = "0"
    return result + "%" * percent


def render(value: Decimal, code: str, *, format_id: int | None = None, date1904: bool = False) -> str:
    """A number as its format shows it. Falls back to General when unsure."""
    if format_id == LOCALE_SHORT_DATE:
        code = UNAMBIGUOUS_DATE
    if not code or code.strip().lower() == "general":
        return general(value)

    sections = _sections(code)
    kind = classify(code)
    if kind in ("date", "time", "datetime"):
        moment = serial_to_datetime(float(value), date1904)
        if moment is None:
            return general(value)
        return _render_date(sections[0], moment, float(value))

    if any(re.search(r"\[[<>=]", section) for section in sections) or "/" in _strip_literals(sections[0]):
        return general(value)  # conditional sections and fractions are not interpreted

    negative = value < 0
    if negative and len(sections) > 1:
        section, value, sign = sections[1], abs(value), ""
    elif value == 0 and len(sections) > 2:
        section, sign = sections[2], ""
    else:
        section, sign = sections[0], "-" if negative else ""
    section_kind = _strip_literals(section).strip()
    if section_kind == "@":
        return general(value)
    try:
        before, pattern, after = _literal_and_pattern(section)
        if not pattern:
            return before + after if before + after else general(value)
        digits = _format_digits(abs(value), pattern)
    except (ArithmeticError, ValueError, IndexError):
        return general(value)
    if sign and digits.strip("0.,%E+-") == "":
        sign = ""  # -0.001 shown with no decimals is "0", not "-0"
    return f"{sign}{before}{digits}{after}".strip()


__all__ = [
    "BUILTIN_FORMATS",
    "FormatKind",
    "classify",
    "general",
    "render",
    "serial_to_datetime",
]
