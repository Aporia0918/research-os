"""Build the immutable Services container: core registries + plugins, then freeze."""

from __future__ import annotations

from pathlib import Path

from ..contracts.approvals import ApprovalSubjectSpec
from ..contracts.docs import DocKindSpec
from ..contracts.gateway import ModelProvider
from ..contracts.tasks import TaskKindSpec
from ..kernel.config import Settings
from ..kernel.migrate import CORE_DIR, CORE_NS
from . import plugins as plugin_loader
from .approval.approvals import task_subject_hash
from .approval.subjects import SubjectRegistry
from .container import Services
from .content.blobs import BlobStore
from .content.docs import DocKindRegistry
from .effects import plan as effect_plan
from .effects.tasks import effect_kinds
from .execution import plans
from .execution.dataset_task import dataset_kind
from .execution.run_task import experiment_kind
from .execution.templates import TemplateRegistry
from .extensions import Extensions, build_extensions
from .gateway.gateway import Gateway
from .gateway.keystore import SecretStore
from .gateway.providers.http import default_providers
from .gateway.tools import ToolRegistry
from .knowledge import imports
from .knowledge.http_fetch import HostHttp
from .knowledge.parse_task import parse_kind
from .literature import monitor
from .literature.tasks import Late, literature_kinds
from .nullworld.task import nullworld_kinds
from .orchestration.builtin import core_kinds
from .orchestration.registry import KindRegistry
from .research import deep_store, deep_tasks


def _tools(ext: Extensions) -> ToolRegistry:
    """Plugin ToolBindings join the AgentRun registry; their context carries no rights beyond the spec."""
    reg = ToolRegistry()
    for b in ext.tools.values():
        reg.register(b.spec, lambda args, b=b: b.impl(args, _NoRightsToolContext()))  # type: ignore[misc]
    return reg


class _NoRightsToolContext:
    run_id = ""
    trace_id = None
    http = None  # network tools receive a HostHttp scoped to granted hosts via the API path (not in AgentRun v1)


def build_services(
    settings: Settings,
    extra_kinds: list[TaskKindSpec] | None = None,
    load_plugins: bool = True,
    providers: dict[str, ModelProvider] | None = None,
) -> Services:
    """`providers` defaults to the real HTTP adapters; tests inject mock providers (no paid calls)."""
    loaded = plugin_loader.load() if load_plugins else plugin_loader.Loaded()
    extensions = build_extensions(loaded)
    templates = TemplateRegistry([settings.templates_dir, *(Path(d) for d in settings.extra_template_dirs)],
                                 extensions.template_roots, settings.config_dir / "REVIEWED.json")
    late = Late()
    kinds = KindRegistry(
        literature_kinds(late)
        + effect_kinds(late)
        + [deep_tasks.deep_kind(late)]
        + core_kinds(settings)
        + nullworld_kinds(settings)
        + [parse_kind(settings), experiment_kind(settings, templates), dataset_kind(settings, extensions)]
        + (extra_kinds or [])
    )
    for k in loaded.by_group.get("researchos.task_kinds", []):
        if isinstance(k, TaskKindSpec):
            kinds.register(k)
    subjects = SubjectRegistry()
    subjects.set_resolver("task", task_subject_hash)
    subjects.set_resolver("plan", plans.plan_subject_hash)
    subjects.set_resolver("final_eval", plans.final_eval_subject_hash)
    subjects.set_resolver("knowledge_import", imports.subject_hash)
    subjects.set_resolver("effect_plan", effect_plan.subject_hash)
    subjects.set_resolver("research_checkpoint", deep_store.checkpoint_hash)
    for s in loaded.by_group.get("researchos.approval_subjects", []):
        if isinstance(s, ApprovalSubjectSpec):
            subjects.add(s)
    doc_kinds = DocKindRegistry()
    for d in loaded.by_group.get("researchos.doc_types", []):
        if isinstance(d, DocKindSpec):
            doc_kinds.add(d)
    keystore = SecretStore(settings.config_dir)
    HostHttp.allow_fake_ip = settings.network_allow_fake_ip
    if providers is None:
        providers = default_providers(settings.relay_base_url, settings.relay_models)
    gateway = Gateway(settings, keystore, providers)
    svc = Services(
        settings=settings,
        kinds=kinds.freeze(),
        subjects=subjects.freeze(),
        doc_kinds=doc_kinds.freeze(),
        keystore=keystore,
        migration_sources={CORE_NS: CORE_DIR},
        gateway=gateway,
        blobs=BlobStore(settings.data_dir),
        tools=_tools(extensions),
        templates=templates,
        extensions=extensions,
        plugins=tuple(loaded.sources),
        triggers=(monitor.trigger, deep_tasks.trigger),
    )
    late.svc = svc
    return svc
