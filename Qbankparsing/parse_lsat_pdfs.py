"""Parse the three LSAT PDFs in OriginalPDFs into a normalized JSON bank.

LSATPDF1 and LSATPDF3 contain embedded text. LSATPDF2 (PrepTest 86) is an
image-only scan, so this script uses Tesseract OCR and caches its page layout
outside the repository in the user's temporary directory.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import subprocess
import tempfile
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parent
PDF_DIR = ROOT / "OriginalPDFs"
DEFAULT_OUTPUT = ROOT / "lsat_questions.json"
OCR_CACHE = Path(tempfile.gettempdir()) / "lsat_pdf2_ocr_layout_v2.json"


@dataclass
class Line:
    page: int
    column: int
    y: float
    text: str
    confidence: float = 1.0
    removed: bool = False


SOURCES = {
    "LSATPDF1.pdf": {
        "test_name": "April 2025 LSAT",
        "form": "LTDA03",
        "extraction_method": "embedded_text",
        "sections": [
            (1, "Logical Reasoning", 4, 11, 25),
            (2, "Logical Reasoning", 12, 19, 25),
            (3, "Reading Comprehension", 20, 27, 27),
        ],
    },
    "LSATPDF2.pdf": {
        "test_name": "LSAT PrepTest 86",
        "form": "8LSN132",
        "extraction_method": "ocr",
        "sections": [
            (1, "Logical Reasoning", 2, 9, 25),
            (2, "Analytical Reasoning", 10, 17, 23),
            (3, "Reading Comprehension", 18, 25, 26),
            (4, "Logical Reasoning", 26, 33, 25),
        ],
    },
    "LSATPDF3.pdf": {
        "test_name": "February 2024 LSAT",
        "form": "LTZD01",
        "extraction_method": "embedded_text",
        "sections": [
            (1, "Analytical Reasoning", 4, 11, 23),
            (2, "Logical Reasoning", 12, 19, 25),
            (3, "Reading Comprehension", 20, 27, 27),
        ],
    },
}


ANSWER_KEYS = {
    ("LTDA03", 1): list("BBCDAEBEDBEDADAAECCCDD CDE".replace(" ", "")),
    ("LTDA03", 2): list("BCEBABEBABDACAEDE CDEADEDA".replace(" ", "")),
    ("LTDA03", 3): list("DAC CDBDADB BEACEBADCCAACDDBC".replace(" ", "")),
    ("8LSN132", 1): list("EDBAADCDCECBCBABEBDBBDDEA"),
    ("8LSN132", 2): list("BCAEAA DCACDEBEDCDDACEDE".replace(" ", "")),
    ("8LSN132", 3): list("ACEBCBEDBADECDA DBEEABD CDEC".replace(" ", "")),
    ("8LSN132", 4): list("BED EBA BAEC CBEABEDCDCEDEDC".replace(" ", "")),
    ("LTZD01", 1): list("CAEBDEACCBCBEDABD CDBBAC".replace(" ", "")),
    ("LTZD01", 2): list("ECBEEE AAB EEDBCEAAAABDBADD".replace(" ", "")),
    ("LTZD01", 3): list("EDBDBCBAEDCCECDACBEAACCABAC"),
}


RC_SPECS = {
    "LTDA03": [
        (20, "In France in the early 1790s", 1, 6),
        (22, "Passage A", 7, 14),
        (24, "The following passage was adapted", 15, 21),
        (26, "The success of modern physics", 22, 27),
    ],
    "8LSN132": [
        (18, "Along with Egypt and Sumer", 1, 6),
        (20, "Film scholar David Bordwell", 7, 13),
        (22, "Passage A", 14, 19),
        (24, "Physicists posit that at first", 20, 26),
    ],
    "LTZD01": [
        (20, "The 1937–1938 comic strip", 1, 6),
        (22, "The following two passages", 7, 14),
        (24, "Since 1929, cosmologists", 15, 21),
        (26, "For most of the past century", 22, 27),
    ],
}


# Tesseract misses a small number of question numbers in the scan. The prefix
# is canonical enough to restore structure without changing question wording.
OCR_QUESTION_PREFIXES = {
    3: [(0, "Archaeologist:", 4), (1, "Many fictional works", 5)],
    5: [(0, "‘Ul. As part", 11), (0, "Ul. As part", 11), (1, "1. When so many oysters", 13)],
    11: [
        (0, "If Martin lectures", 2),
        (0, "Which one of the following is a pair", 3),
        (0, "If Kennedy lectures", 4),
        (1, "Which one of the following, if substituted", 6),
    ],
    19: [
        (0, "Based on the passage", 3),
        (0, "Which one of the following is cited", 4),
        (1, "The author would be most likely to agree", 6),
    ],
    20: [
        (1, "Which one of the following most accurately states", 7),
        (1, "The passage identifies each", 8),
        (1, "The author uses the term", 9),
    ],
    21: [(1, "The narrative structure", 12)],
    25: [(1, "It can be inferred from the passage", 26)],
    27: [(0, "Businessperson:", 5), (1, "Nutritionist:", 7)],
    29: [(1, "The Amazon River", 12)],
    30: [(1, "Commentator:", 15)],
    33: [(1, "Bditorial:", 25), (1, "Editorial:", 25)],
}


OCR_TEXT_CORRECTIONS = {
    "Bditorial:": "Editorial:",
    "high-calctum": "high-calcium",
    "Phyilis": "Phyllis",
    "archacologically": "archaeologically",
    "B.c.": "B.C.",
    "J ennifer": "Jennifer",
    "lecturés": "lectures",
    "come to pass. .": "come to pass.",
    "ownership i is": "ownership is",
    "could be true’": "could be true?",
    "thrce": "three",
    "next’": "next",
    "investigations. into": "investigations into",
    "CANNOT be auctioned oe:": "CANNOT be auctioned:",
    "to-the field of archaeology ~ of the": "to the field of archaeology",
    "would ‘disagree": "would disagree",
    "one of — the": "one of the",
    "people s: choices": "people's choices",
    "are — continuing": "are continuing",
    "possessed the © manual": "possessed the manual",
    "as! EDs": "PEDs",
    "G0)": "(30)",
    "? mo": "?",
    "fifth mo": "fifth",
    "ones.:": "ones.",
    "in. order": "in order",
}


JOINED_TEXT_CORRECTIONS = {
    "Six doctors—-Graham": "Six doctors—Graham",
    "Krone mine": "Krona mine",
    "style as. being": "style as being",
    "audience. watching": "audience watching",
    "external duress, — people": "external duress, people",
    "behaviors—-even — high-level": "behaviors—even high-level",
    "extremely. rapid": "extremely rapid",
    "in 1 an order": "in an order",
    "The day to which Graham is assigned must be immediately before or immediately after a day to which Koppel is assigned. before Herrera cannot be assigned to a day immediately or immediately after a day to which Nelson is assigned.":
        "The day to which Graham is assigned must be immediately before or immediately after a day to which Koppel is assigned. Herrera cannot be assigned to a day immediately before or immediately after a day to which Nelson is assigned.",
}


QUESTION_OVERRIDES = {
    "8LSN132-S1-Q14": {"choices": {"C": "Most animals that carry rabies are animals of species that, under normal conditions, very rarely bite people."}},
    "8LSN132-S1-Q23": {
        "stimulus": "Male boto dolphins often carry objects such as weeds or sticks. Researchers first thought this was play behavior, but it is more likely to be a mating display. If it were play rather than a mating display, we would expect females and juveniles to engage in the behavior, but only adult males do."
    },
    "8LSN132-S2-Q02": {"choices": {"D": "Martin lectures on Thursday."}},
    "8LSN132-S2-Q08": {"choices": {"B": "second", "C": "third"}},
    "8LSN132-S2-Q09": {"choices": {"E": "The Villa is auctioned second."}},
    "8LSN132-S2-Q11": {
        "stem": "If the Villa is auctioned fourth, then how many of the paintings are there that could be the one auctioned second?"
    },
    "8LSN132-S2-Q13": {
        "choices": {"B": "June: Grayson; July: headquarters; August: Grayson; September: headquarters; October: Krona"}
    },
    "8LSN132-S2-Q14": {"choices": {"A": "March", "B": "May", "C": "June", "D": "September"}},
    "8LSN132-S2-Q19": {
        "choices": {"B": "Herrera is assigned to Thursday.", "D": "Koppel is assigned to Friday."}
    },
    "8LSN132-S2-Q20": {
        "stem": "If Koppel is assigned to Thursday, then any of the following could be true EXCEPT:",
        "choices": {"E": "Nelson is assigned to Wednesday."},
    },
    "8LSN132-S3-Q03": {
        "choices": {
            "A": "enthusiastic appreciation of its contributions to the field of archaeology",
            "B": "grudging approval of those aspects of the theory that have not been refuted by recent research",
        }
    },
    "8LSN132-S3-Q11": {
        "choices": {"E": "Most musical films of the 1930s concentrated on telling realistic stories."}
    },
    "8LSN132-S3-Q24": {
        "stem": "The author’s reference to a suggestion by Garriga and Vilenkin in the fifth paragraph primarily serves to",
        "choices": {"B": "raise a potential objection to Carroll and Chen’s theory"},
    },
    "8LSN132-S4-Q17": {
        "choices": {
            "A": "Health-care facility employees do not regard mandatory vaccination policies as violating their rights.",
            "D": "Voluntary vaccination policies at health-care facilities would not adequately protect patients from the risks posed by influenza viruses.",
        }
    },
    "8LSN132-S4-Q20": {
        "stimulus": "Coming up with secure passwords for confidential computer files is difficult. Users prefer passwords that are easy to remember, such as birth dates or relatives’ names. Unfortunately, these are the easiest to guess for an outsider who wants to gain access to valuable information. Random configurations of letters and numbers are the hardest to guess, but these are also the easiest for legitimate users to forget. Users who forget their passwords use up the system administrator’s time; furthermore, passwords that are very difficult to remember are generally written down by users, and hence pose the greatest security threat of all."
    },
}


NOISE_PATTERNS = [
    re.compile(r"^GO ON TO THE NEXT PAGE", re.I),
    re.compile(r"^IF YOU FINISH BEFORE TIME IS CALLED", re.I),
    re.compile(r"^DO NOT WORK ON ANY", re.I),
    re.compile(r"^MAY CHECK YOUR WORK", re.I),
    re.compile(r"^OTHER SECTION IN THE TEST", re.I),
    re.compile(r"^S\s*T\s*O?\s*P$", re.I),
    re.compile(r"^O\s*P$", re.I),
    re.compile(r"^-?\d+-?$"),
    re.compile(r"^\d+[.]$"),
    re.compile(r"^www\.cracklsat\.net", re.I),
]


def find_tesseract() -> Path:
    candidates = [
        Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
        Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    from shutil import which

    found = which("tesseract")
    if found:
        return Path(found)
    raise RuntimeError("Tesseract OCR is required to parse LSATPDF2.pdf")


def geometric_lines(tsv: str, width: int, height: int, page: int) -> list[list[Line]]:
    words = []
    for row in csv.DictReader(io.StringIO(tsv), delimiter="\t"):
        if row.get("level") != "5" or not row.get("text", "").strip():
            continue
        x, y, w, h = map(int, (row["left"], row["top"], row["width"], row["height"]))
        if not 220 < y < min(height - 180, 4200):
            continue
        words.append(
            {
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "center": y + h / 2,
                "text": row["text"],
                "confidence": max(0.0, float(row.get("conf", 0))) / 100,
            }
        )

    columns: list[list[Line]] = []
    for column, (low, high) in enumerate(((0, width / 2), (width / 2, width + 1))):
        selected = [w for w in words if low <= w["x"] + w["w"] / 2 < high]
        clusters: list[dict] = []
        for word in sorted(selected, key=lambda item: (item["center"], item["x"])):
            match = None
            for cluster in reversed(clusters[-5:]):
                if abs(cluster["center"] - word["center"]) <= 18:
                    match = cluster
                    break
            if match is None:
                clusters.append({"center": word["center"], "words": [word]})
            else:
                match["words"].append(word)
                match["center"] = sum(w["center"] for w in match["words"]) / len(match["words"])

        lines = []
        for cluster in clusters:
            ordered = sorted(cluster["words"], key=lambda item: item["x"])
            text = " ".join(w["text"] for w in ordered)
            confidence = sum(w["confidence"] for w in ordered) / len(ordered)
            lines.append(Line(page, column, cluster["center"], text, confidence))
        columns.append(lines)
    return columns


def load_or_create_ocr_layout(pdf_path: Path, refresh: bool = False) -> dict[int, list[list[Line]]]:
    if OCR_CACHE.exists() and not refresh:
        raw = json.loads(OCR_CACHE.read_text(encoding="utf-8"))
    else:
        reader = PdfReader(str(pdf_path))
        tesseract = find_tesseract()
        raw = {}
        for page_number in range(2, 34):
            image = max(
                reader.pages[page_number - 1].images,
                key=lambda item: item.image.width * item.image.height,
            ).image
            with tempfile.TemporaryDirectory() as temp_dir:
                image_path = Path(temp_dir) / "page.png"
                image.save(image_path)
                result = subprocess.run(
                    [str(tesseract), str(image_path), "stdout", "-l", "eng", "--psm", "3", "tsv"],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    check=True,
                )
            columns = geometric_lines(result.stdout, image.width, image.height, page_number)
            raw[str(page_number)] = [
                [
                    {
                        "page": line.page,
                        "column": line.column,
                        "y": line.y,
                        "text": line.text,
                        "confidence": line.confidence,
                    }
                    for line in column
                ]
                for column in columns
            ]
        OCR_CACHE.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")

    return {
        int(page): [
            [Line(**entry) for entry in column]
            for column in columns
        ]
        for page, columns in raw.items()
    }


def normalize_ocr_line(line: Line) -> None:
    text = line.text.strip()
    text = re.sub(r"^[_.|~—-]+\s+(?=\S)", "", text)
    text = re.sub(r"^\(BE\)", "(E)", text)
    text = re.sub(r"^©\)", "(E)", text)
    text = re.sub(r"^&\)", "(E)", text)
    text = re.sub(r"^-\(([A-E])\)", r"(\1)", text)
    text = re.sub(r"^[i‘']\s+(?=\([A-E]\))", "", text)
    text = re.sub(r"^\((A|B|C|D|E)\)\s*[_.—-]+\s*", r"(\1) ", text)
    text = re.sub(r"^_\s*\((A|B|C|D|E)\)", r"(\1)", text)
    for old, new in OCR_TEXT_CORRECTIONS.items():
        text = text.replace(old, new)
    text = re.sub(r"\bmore tha\b", "more than", text)
    text = re.sub(r"(?:(?<=\s)|^)[_|~©](?=\s|$)", " ", text)
    text = re.sub(r"\b(?:mo|oo)\b", "", text)
    text = re.sub(r"\s+([,.;:?!])", r"\1", text)
    text = re.sub(r"\s{2,}", " ", text)
    line.text = text.strip()


def patch_ocr_question_numbers(layout: dict[int, list[list[Line]]]) -> None:
    for page, columns in layout.items():
        for column in columns:
            for line in column:
                normalize_ocr_line(line)
        for column_number, prefix, question_number in OCR_QUESTION_PREFIXES.get(page, []):
            for line in columns[column_number]:
                if line.text.startswith(prefix):
                    line.text = re.sub(r"^[‘']?U?l?\.?\s*", "", line.text)
                    line.text = re.sub(r"^1\.\s+(?=When so many oysters)", "", line.text)
                    line.text = f"{question_number}. {line.text}"
                    break
    # On page 12 the two halves of the game-range heading were detected in
    # reverse vertical order.
    for line in layout[12][0]:
        if line.text == "7-12":
            line.text = "Questions 7-12"
        elif line.text == "Questions":
            line.text = ""
    # Non-content specks detected above the third game's scenario.
    for line in layout[14][0]:
        if line.text in {"St", "a"}:
            line.text = ""


def embedded_lines(pdf_path: Path, first_page: int, last_page: int) -> list[Line]:
    reader = PdfReader(str(pdf_path))
    lines = []
    for page_number in range(first_page, last_page + 1):
        text = reader.pages[page_number - 1].extract_text() or ""
        for index, value in enumerate(text.splitlines()):
            value = value.strip()
            if value:
                # In two-column section-opening pages, pypdf can concatenate
                # the header's question count with the first item in column 2.
                value = re.sub(r"^\d+\s+Questions(\d{1,2})\.\s+", r"\1. ", value)
                lines.append(Line(page_number, 0, float(index), value))
    return lines


def ocr_lines(layout: dict[int, list[list[Line]]], first_page: int, last_page: int) -> list[Line]:
    return [
        line
        for page in range(first_page, last_page + 1)
        for column in layout[page]
        for line in column
    ]


def is_noise(text: str) -> bool:
    stripped = text.strip()
    if not stripped or stripped in {"_", "|", ".", "~", "—", "-", ":", ">."}:
        return True
    return any(pattern.match(stripped) for pattern in NOISE_PATTERNS)


def clean_join(lines: Iterable[Line | str], passage: bool = False) -> str:
    values = [item.text if isinstance(item, Line) else item for item in lines]
    cleaned = []
    for value in values:
        value = value.strip()
        if is_noise(value):
            continue
        value = re.sub(r"^[_.|~—-]+\s*(?=[A-Za-z])", "", value)
        if passage and re.fullmatch(r"\(\d{1,3}\)", value):
            continue
        value = re.sub(r"^\(\d{1,3}\)\s+", "", value) if passage else value
        value = re.sub(r"\s+", " ", value)
        cleaned.append(value)

    output = ""
    for value in cleaned:
        if not output:
            output = value
        elif output.endswith("-"):
            output += value
        else:
            output += " " + value
    output = re.sub(r"\s+([,.;:?!])", r"\1", output)
    output = re.sub(r"\(\s+", "(", output)
    output = re.sub(r"\s+\)", ")", output)
    output = re.sub(r"\s{2,}", " ", output)
    for old, new in OCR_TEXT_CORRECTIONS.items():
        output = output.replace(old, new)
    for old, new in JOINED_TEXT_CORRECTIONS.items():
        output = output.replace(old, new)
    output = re.sub(r"\bmore tha\b", "more than", output)
    output = re.sub(r"(?:(?<=\s)|^)[_|~©]+(?=\s|$)", " ", output)
    output = re.sub(r"\.{2,}", ".", output)
    output = re.sub(r"\s+([,.;:?!])", r"\1", output)
    output = re.sub(r"\s{2,}", " ", output)
    return output.strip()


def extract_rc_passages(
    lines: list[Line], form: str, extraction_method: str
) -> tuple[list[dict], dict[int, str]]:
    passages = []
    question_to_passage = {}
    for index, (page, prefix, first_question, last_question) in enumerate(RC_SPECS[form], 1):
        page_lines = [line for line in lines if line.page == page and not line.removed]
        start = next(i for i, line in enumerate(page_lines) if line.text.startswith(prefix))
        question_pattern = re.compile(rf"^{first_question}[.,]\s+")
        end = next(i for i, line in enumerate(page_lines[start + 1 :], start + 1) if question_pattern.match(line.text))
        raw_selected = page_lines[start:end]
        start_line = page_lines[start]
        selected = [
            line
            for line in raw_selected
            if not (line.column > start_line.column and line.y < start_line.y)
        ]
        for line in raw_selected:
            line.removed = True
        passage_id = f"{form}-RC-P{index}"
        passages.append(
            {
                "id": passage_id,
                "source_pdf": next(name for name, meta in SOURCES.items() if meta["form"] == form),
                "form": form,
                "section": "Reading Comprehension",
                "passage_number": index,
                "source_page": page,
                "question_range": [first_question, last_question],
                "passage_type": "comparative" if "Passage A" in clean_join(selected, True) else "single",
                "text": clean_join(selected, passage=True),
                "extraction_method": extraction_method,
                "extraction_confidence": round(sum(line.confidence for line in selected) / len(selected), 4),
                "review_status": "ocr_needs_review" if extraction_method == "ocr" else "machine_parsed_needs_review",
            }
        )
        for question_number in range(first_question, last_question + 1):
            question_to_passage[question_number] = passage_id
    return passages, question_to_passage


def extract_ar_scenarios(
    lines: list[Line], form: str, extraction_method: str
) -> tuple[list[dict], dict[int, str]]:
    passages = []
    question_to_passage = {}
    marker_pattern = re.compile(r"^Questions\s+(\d+)\s*[–—-]\s*(\d+)", re.I)
    for marker_index, marker in enumerate(list(lines)):
        match = marker_pattern.match(marker.text)
        if not match or marker.removed:
            continue
        first_question, last_question = map(int, match.groups())
        selected = []
        marker.removed = True
        for line in lines[marker_index + 1 :]:
            if re.match(rf"^{first_question}[.,]\s+", line.text):
                break
            if marker_pattern.match(line.text):
                break
            line.removed = True
            if not (line.column > marker.column and line.y < marker.y):
                selected.append(line)
        passage_id = f"{form}-AR-G{len(passages) + 1}"
        passages.append(
            {
                "id": passage_id,
                "source_pdf": next(name for name, meta in SOURCES.items() if meta["form"] == form),
                "form": form,
                "section": "Analytical Reasoning",
                "game_number": len(passages) + 1,
                "source_page": marker.page,
                "question_range": [first_question, last_question],
                "passage_type": "analytical_reasoning_scenario",
                "text": clean_join(selected, passage=True),
                "extraction_method": extraction_method,
                "extraction_confidence": round(sum(line.confidence for line in selected) / max(1, len(selected)), 4),
                "review_status": "ocr_needs_review" if extraction_method == "ocr" else "machine_parsed_needs_review",
            }
        )
        for question_number in range(first_question, last_question + 1):
            question_to_passage[question_number] = passage_id
    return passages, question_to_passage


def parse_choice_lines(block: list[Line]) -> tuple[list[Line], list[dict]]:
    markers = []
    choice_pattern = re.compile(r"^\(([A-E])\)\s*(.*)$")
    for index, line in enumerate(block):
        match = choice_pattern.match(line.text)
        if match:
            markers.append((index, match.group(1), match.group(2)))
    if [label for _, label, _ in markers] != list("ABCDE"):
        raise ValueError(
            f"Expected choices A-E on page {block[0].page}; found {[label for _, label, _ in markers]}: "
            f"{clean_join(block)[:220]}"
        )
    pre_choice = block[: markers[0][0]]
    choices = []
    for marker_number, (start, label, first_text) in enumerate(markers):
        end = markers[marker_number + 1][0] if marker_number + 1 < len(markers) else len(block)
        text_lines: list[str | Line] = []
        if first_text:
            text_lines.append(first_text)
        text_lines.extend(block[start + 1 : end])
        choices.append({"label": label, "text": clean_join(text_lines)})
    return pre_choice, choices


STEM_START = re.compile(
    r"^(Which|Each|The (?:argument|reasoning|statement|claim|conclusion|dialogue|pattern|information|fact|author)|"
    r"The .{0,90}(?:argument|conclusion|explanation|reasoning|prohibition)|"
    r"If the|If this|If it|Young responds|Cora’s claim|Cora's claim|Based on|According to|It can be|Any of|"
    r"How many|How could|An acceptable|Suppose\b|Pratt’s argument|Pratt's argument|On the basis|In the passage|"
    r"-?A flaw in|Hernandez and Liu|Professor O’Brien’s|Professor O'Brien's|Dr[.] Cortez’s reasoning|Dr[.] Cortez's reasoning)",
    re.I,
)


def split_lr_prompt(lines: list[Line]) -> tuple[str, str]:
    candidates = [i for i, line in enumerate(lines) if STEM_START.match(line.text)]
    if not candidates:
        return "", clean_join(lines)
    # Stem trigger lines occasionally wrap onto another trigger-looking line
    # (for example, "Which ..." followed by "the argument?"). The first
    # trigger is therefore the correct boundary.
    start = candidates[0]
    return clean_join(lines[:start]), clean_join(lines[start:])


def lr_type(text: str) -> str:
    value = text.lower()
    if "disagree over whether" in value or "disagreeing about" in value or "disagree with each other" in value or "point at issue" in value:
        return "Point at Issue"
    if "flawed reasoning" in value and ("most similar" in value or "most closely resembles" in value):
        return "Parallel Flaw"
    if "reasoning in which one of the following arguments" in value:
        return "Parallel Reasoning"
    if ("most similar" in value or "most closely resembles" in value or "parallel" in value) and "reasoning" in value:
        return "Parallel Reasoning"
    if "most vulnerable" in value or "error in" in value or "flaw" in value or "questionable in that" in value or "does not follow logically" in value:
        return "Flaw"
    if (
        "assumption on which" in value
        or "depends on which" in value
        or "argument depends on assuming" in value
        or "relies on assuming" in value
        or "relies on which" in value
        or "assumption required" in value
        or "is assumed" in value
        or "required by the argument" in value
    ):
        return "Necessary Assumption"
    if "follows logically if" in value or "properly drawn" in value or "logically follows if" in value:
        return "Sufficient Assumption"
    if "helps to justify" in value or "most justifies" in value or ("principle" in value and ("justify" in value or "supports" in value)):
        return "Principle: Justify"
    if "conforms most closely" in value or "most clearly illustrated" in value or "most closely illustrates" in value or "application of the principle" in value or "at odds with which" in value:
        return "Principle: Apply"
    if "statements above" in value and "support which" in value:
        return "Inference"
    if "weaken" in value or "calls into question" in value or "undermines" in value:
        return "Weaken"
    if "strengthen" in value or "provides the most support" in value or "additional evidence in support" in value or "most strongly supports" in value or "most supports" in value or "would support" in value:
        return "Strengthen"
    if "help to explain" in value or "helps to explain" in value or "most helps to explain" in value or "resolve" in value or "reconcile" in value:
        return "Resolve/Explain"
    if "most accurately expresses" in value and "conclusion" in value:
        return "Main Conclusion"
    if "main conclusion" in value or "main point" in value:
        return "Main Conclusion"
    if "plays which" in value or "role in" in value or "role does" in value or "role played" in value or "characterizes the role" in value:
        return "Role in Argument"
    if "responds to" in value or "argument proceeds" in value or "method of reasoning" in value or "grounds on which" in value or "author does which" in value:
        return "Method of Reasoning"
    if "cannot be true" in value:
        return "Cannot Be True"
    if "could be true" in value:
        return "Could Be True"
    if "must be true" in value or "must also be true" in value or "most strongly supported" in value or "can be inferred" in value:
        return "Inference"
    if "completes the passage" in value or "completes the argument" in value or "most logically completes" in value:
        return "Complete the Argument"
    if "evaluate" in value or "useful to know" in value or "assess the support" in value:
        return "Evaluate"
    return "Other Logical Reasoning"


def rc_type(text: str) -> str:
    value = text.lower()
    if re.search(r"\bpassage [ab]\b", value) or "both passages" in value or "authors of the passages" in value:
        if "meaning" in value or "phrase" in value or "concept" in value:
            return "Comparative: Connection"
        return "Comparative"
    if "main point" in value or "main idea" in value or "central idea" in value or "passage is primarily concerned" in value:
        return "Main Point"
    if "primary purpose" in value or "primarily concerned with doing" in value:
        return "Primary Purpose"
    if "organization" in value or "organized" in value:
        return "Organization"
    if "attitude" in value or "stance" in value or "tone" in value:
        return "Author Attitude"
    if "meaning of" in value or "most closely means" in value or "defines" in value or "term “" in value or 'term "' in value:
        return "Meaning in Context"
    if "primarily serves" in value or "primarily in order to" in value or "primarily to suggest" in value or "function" in value or "introduces the example" in value or "purpose of the" in value:
        return "Function/Role"
    if "analog" in value or "parallel" in value or "most similar" in value:
        return "Analogy/Application"
    if "according to" in value or "summarizes the position" in value or "cited" in value or "identified" in value or "mentioned" in value or "passage indicates" in value or "misleading because" in value or "except" in value:
        return "Detail"
    if "inferred" in value or "implied" in value or "most likely have held" in value or "most likely to agree" in value or "would most likely agree" in value or "would agree" in value or "most strongly suggested" in value or "most strongly supported" in value or "provides information" in value or "provides the most support" in value:
        return "Inference"
    if "most strongly supports the author" in value or "lend the most support" in value:
        return "Strengthen"
    if "principle" in value and "underlies" in value:
        return "Principle"
    if "call into question" in value:
        return "Weaken"
    if "appear to value" in value:
        return "Author Attitude"
    if "most like which" in value:
        return "Analogy/Application"
    return "Other Reading Comprehension"


def ar_type(text: str) -> str:
    value = text.lower()
    if "substituted for" in value and "same effect" in value:
        return "Rule Substitution"
    if "complete and accurate list" in value:
        return "Complete List"
    if "maximum" in value or "minimum" in value or "how many" in value or "earliest" in value or "latest" in value:
        return "Maximum/Minimum"
    if "cannot" in value or "except" in value:
        return "Cannot Be True"
    if "must be true" in value or "must work" in value:
        return "Must Be True"
    if "could be true" in value or "could be featured" in value:
        return "Could Be True"
    if "could be the" in value or "could be an accurate" in value or "acceptable" in value:
        return "Acceptable Arrangement"
    if " if which one" in value or value.startswith("if "):
        return "Conditional"
    return "Other Analytical Reasoning"


def difficulty(section: str, question_type: str, number: int, count: int, prompt_length: int, game_number: int | None) -> int:
    if section == "Logical Reasoning":
        position = number / count
        score = 1.4 + 3.0 * position
        adjustments = {
            "Parallel Flaw": 0.7,
            "Parallel Reasoning": 0.6,
            "Sufficient Assumption": 0.4,
            "Necessary Assumption": 0.3,
            "Flaw": 0.2,
            "Role in Argument": -0.3,
            "Main Conclusion": -0.4,
            "Resolve/Explain": -0.1,
        }
        score += adjustments.get(question_type, 0)
        if prompt_length > 1700:
            score += 0.35
    elif section == "Reading Comprehension":
        score = {
            "Detail": 2.2,
            "Meaning in Context": 2.4,
            "Main Point": 2.8,
            "Primary Purpose": 2.9,
            "Organization": 3.0,
            "Function/Role": 3.1,
            "Author Attitude": 3.2,
            "Inference": 3.6,
            "Analogy/Application": 3.8,
            "Comparative": 3.6,
            "Comparative: Connection": 3.8,
        }.get(question_type, 3.2)
        score += 0.25 * ((number - 1) % 7) / 6
    else:
        score = 1.8 + 0.55 * max(0, (game_number or 1) - 1)
        score += {
            "Acceptable Arrangement": -0.4,
            "Could Be True": 0.2,
            "Must Be True": 0.5,
            "Cannot Be True": 0.5,
            "Maximum/Minimum": 0.5,
            "Complete List": 0.6,
            "Rule Substitution": 1.2,
        }.get(question_type, 0.3)
    return max(1, min(5, int(math.floor(score + 0.5))))


def question_hash(stimulus: str | None, stem: str, choices: list[dict]) -> str:
    canonical = json.dumps(
        {"stimulus": stimulus, "stem": stem, "choices": choices},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def passage_number_from_id(passage_id: str | None) -> int | None:
    if not passage_id or "-G" not in passage_id:
        return None
    return int(passage_id.rsplit("G", 1)[1])


def parse_section(
    source_pdf: str,
    section_number: int,
    section: str,
    first_page: int,
    last_page: int,
    expected_count: int,
    layout: dict[int, list[list[Line]]] | None,
) -> tuple[list[dict], list[dict]]:
    meta = SOURCES[source_pdf]
    form = meta["form"]
    extraction_method = meta["extraction_method"]
    if extraction_method == "ocr":
        assert layout is not None
        lines = ocr_lines(layout, first_page, last_page)
    else:
        lines = embedded_lines(PDF_DIR / source_pdf, first_page, last_page)

    passages: list[dict] = []
    question_to_passage: dict[int, str] = {}
    if section == "Reading Comprehension":
        passages, question_to_passage = extract_rc_passages(lines, form, extraction_method)
    elif section == "Analytical Reasoning":
        passages, question_to_passage = extract_ar_scenarios(lines, form, extraction_method)

    active = [line for line in lines if not line.removed]
    starts = []
    for index, line in enumerate(active):
        match = re.match(r"^(\d{1,2})[.,]\s+(.*)$", line.text)
        if match and 1 <= int(match.group(1)) <= expected_count:
            starts.append((index, int(match.group(1))))
    numbers = [number for _, number in starts]
    if numbers != list(range(1, expected_count + 1)):
        raise ValueError(f"{form} section {section_number}: question sequence {numbers}")

    answer_key = ANSWER_KEYS[(form, section_number)]
    if len(answer_key) != expected_count:
        raise ValueError(f"{form} section {section_number}: answer key has {len(answer_key)} entries, expected {expected_count}")

    questions = []
    difficulty_labels = {1: "very_easy", 2: "easy", 3: "medium", 4: "hard", 5: "very_hard"}
    for ordinal, (start, number) in enumerate(starts):
        end = starts[ordinal + 1][0] if ordinal + 1 < len(starts) else len(active)
        block = [Line(**vars(line)) for line in active[start:end]]
        block[0].text = re.sub(r"^\d{1,2}[.,]\s+", "", block[0].text)
        pre_choice, choices = parse_choice_lines(block)
        passage_id = question_to_passage.get(number)

        if section == "Logical Reasoning":
            stimulus, stem = split_lr_prompt(pre_choice)
            question_type = lr_type(stem or clean_join(pre_choice))
            stimulus_value: str | None = stimulus or None
        elif section == "Reading Comprehension":
            stimulus_value = None
            stem = clean_join(pre_choice)
            question_type = rc_type(stem)
        else:
            stimulus_value = None
            stem = clean_join(pre_choice)
            question_type = ar_type(stem)

        question_id = f"{form}-S{section_number}-Q{number:02d}"
        override = QUESTION_OVERRIDES.get(question_id, {})
        if "stimulus" in override:
            stimulus_value = override["stimulus"]
        if "stem" in override:
            stem = override["stem"]
        for choice in choices:
            choice["text"] = override.get("choices", {}).get(choice["label"], choice["text"])
        if section == "Logical Reasoning":
            question_type = lr_type(stem)
        elif section == "Reading Comprehension":
            question_type = rc_type(stem)
        else:
            question_type = ar_type(stem)

        level = difficulty(
            section,
            question_type,
            number,
            expected_count,
            len((stimulus_value or "") + stem),
            passage_number_from_id(passage_id),
        )
        confidence_lines = [line for line in block if not is_noise(line.text)]
        confidence = sum(line.confidence for line in confidence_lines) / max(1, len(confidence_lines))
        questions.append(
            {
                "id": question_id,
                "source_pdf": source_pdf,
                "test_name": meta["test_name"],
                "form": form,
                "section_number": section_number,
                "section": section,
                "question_number": number,
                "source_page": block[0].page,
                "passage_id": passage_id,
                "question_type": question_type,
                "question_type_basis": "inferred_from_stem_needs_review",
                "difficulty": level,
                "difficulty_label": difficulty_labels[level],
                "difficulty_basis": "estimated_heuristic_needs_review",
                "stimulus": stimulus_value,
                "stem": stem,
                "choices": choices,
                "correct_answer": answer_key[number - 1],
                "content_hash": question_hash(stimulus_value, stem, choices),
                "extraction_method": extraction_method,
                "extraction_confidence": round(confidence, 4),
                "license_status": "unknown_needs_verification",
                "review_status": "ocr_needs_review" if extraction_method == "ocr" else "machine_parsed_needs_review",
            }
        )
    return questions, passages


def validate(bank: dict) -> dict:
    questions = bank["questions"]
    passages = bank["passages"]
    ids = [question["id"] for question in questions]
    passage_ids = {passage["id"] for passage in passages}
    errors = []
    if len(ids) != len(set(ids)):
        errors.append("duplicate question IDs")
    for question in questions:
        if [choice["label"] for choice in question["choices"]] != list("ABCDE"):
            errors.append(f"{question['id']}: invalid choices")
        if question["correct_answer"] not in "ABCDE":
            errors.append(f"{question['id']}: invalid answer")
        if question["passage_id"] and question["passage_id"] not in passage_ids:
            errors.append(f"{question['id']}: missing passage")
        if question["section"] in {"Reading Comprehension", "Analytical Reasoning"} and not question["passage_id"]:
            errors.append(f"{question['id']}: no shared passage/scenario")
        if not question["stem"]:
            errors.append(f"{question['id']}: missing stem")
    expected = {"LTDA03": 77, "8LSN132": 99, "LTZD01": 75}
    actual = Counter(question["form"] for question in questions)
    if dict(actual) != expected:
        errors.append(f"wrong source counts: {dict(actual)}")
    if errors:
        raise ValueError("Validation failed: " + "; ".join(errors[:20]))
    return {
        "valid": True,
        "question_count": len(questions),
        "passage_count": len(passages),
        "by_source": dict(actual),
        "by_section": dict(Counter(question["section"] for question in questions)),
        "by_difficulty": dict(Counter(str(question["difficulty"]) for question in questions)),
        "by_question_type": dict(Counter(question["question_type"] for question in questions)),
    }


def build_bank(refresh_ocr: bool = False) -> dict:
    layout = load_or_create_ocr_layout(PDF_DIR / "LSATPDF2.pdf", refresh_ocr)
    patch_ocr_question_numbers(layout)
    questions = []
    passages = []
    for source_pdf, meta in SOURCES.items():
        for section_number, section, first_page, last_page, count in meta["sections"]:
            parsed_questions, parsed_passages = parse_section(
                source_pdf,
                section_number,
                section,
                first_page,
                last_page,
                count,
                layout if source_pdf == "LSATPDF2.pdf" else None,
            )
            questions.extend(parsed_questions)
            passages.extend(parsed_passages)

    bank = {
        "schema_version": "1.0.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "notes": [
            "Difficulty is an estimated 1-5 label, not an official LSAC rating.",
            "LSATPDF2 is an image-only scan; its OCR-derived wording must be checked against the source before publication.",
            "The PrepTest 86 answer-key page is absent from LSATPDF2; answers were recovered from the answer-key URL embedded in that PDF.",
            "License status is intentionally unapproved until the intended use is verified with the rights holder.",
        ],
        "difficulty_scale": {
            "1": "very_easy",
            "2": "easy",
            "3": "medium",
            "4": "hard",
            "5": "very_hard",
        },
        "sources": [
            {
                "source_pdf": name,
                "test_name": meta["test_name"],
                "form": meta["form"],
                "extraction_method": meta["extraction_method"],
                "answer_key_source": (
                    "https://www.cracklsat.net/lsat-explanations/preptest-86/"
                    if meta["form"] == "8LSN132"
                    else "embedded_in_source_pdf"
                ),
                "expected_questions": sum(section[4] for section in meta["sections"]),
            }
            for name, meta in SOURCES.items()
        ],
        "passages": passages,
        "questions": questions,
    }
    bank["validation"] = validate(bank)
    return bank


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--refresh-ocr", action="store_true")
    args = parser.parse_args()
    bank = build_bank(args.refresh_ocr)
    args.output.write_text(json.dumps(bank, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(bank["validation"], indent=2))
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
