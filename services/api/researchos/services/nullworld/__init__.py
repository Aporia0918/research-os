"""Null-world exam (零世界考试): does a pipeline still score above chance once the labels carry no signal?

Public interface, used by the API, the phone flow and the desktop app alike:

    detect(Table.parse(raw))      -> Structure     guessed group/label columns, for the person to confirm
    run_exam(ExamSpec(...))       -> ExamReport    real score, null-world scores, verdict, seeds and hashes

Everything else in this package is an implementation detail.
"""

from .exam import ExamReport, ExamSpec, run_exam
from .table import Structure, Table, TableError, detect
from .verdict import Verdict

__all__ = ["ExamReport", "ExamSpec", "Structure", "Table", "TableError", "Verdict", "detect", "run_exam"]
