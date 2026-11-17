"""Null-world exam (零世界考试): does a pipeline still score above chance once the labels carry no signal?

Public interface, used by the API, the phone flow and the desktop app alike:

    detect(Table.parse(raw))      -> Structure     guessed group/label columns, for the person to confirm
    run_exam(ExamSpec(...))       -> ExamReport    real score, null-world scores, verdict, seeds and hashes
    run_power(PowerSpec(...))     -> PowerReport   planted effects: detection rate per effect size and subject count

Everything else in this package is an implementation detail.
"""

from .exam import ExamReport, ExamSpec, run_exam
from .power import PowerReport, PowerSpec, run_power
from .table import Structure, Table, TableError, detect
from .verdict import Verdict

__all__ = [
    "ExamReport",
    "ExamSpec",
    "PowerReport",
    "PowerSpec",
    "Structure",
    "Table",
    "TableError",
    "Verdict",
    "detect",
    "run_exam",
    "run_power",
]
