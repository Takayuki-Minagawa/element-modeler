#!/usr/bin/env python3
"""Validate/convert analysis v2 to OpenSeesPy; execute a 3D linear static case."""
import argparse
from datetime import datetime, timezone
import math
from pathlib import Path
import sys

from analysis_common import (ModelError, atomic_write, axes, cross, finite, fingerprint,
                             geometry, indexed, point, read_model, write_json)

DOFS = ("dx", "dy", "dz", "rx", "ry", "rz")
LOADS = ("fx", "fy", "fz", "mx", "my", "mz")


def prepare(model, load_case, self_weight="error"):
    nodes, elements, sections = geometry(model)
    materials = indexed(model.get("materials"), "materials", "name")
    cases = model.get("loadCases", [])
    if load_case not in cases:
        raise ModelError(f"Unknown load case {load_case!r}; select an explicit case, not a combination")
    mode = model.get("selfWeight", {}).get("mode")
    if mode not in ("fromDensity", "includedInDL"):
        raise ModelError("selfWeight.mode must be fromDensity or includedInDL")
    if self_weight not in ("error", "omit"):
        raise ModelError("self_weight must be error or omit")
    if mode == "fromDensity" and self_weight != "omit":
        raise ModelError("Density self-weight is outside the nodal-load subset. Supply explicit nodal DL and "
                         "set includedInDL, or explicitly use --self-weight omit for a load-only study")
    used = set()
    ignored_shear_sections = set()
    prepared_elements = []
    for e in elements.values():
        if e.get("type") not in ("beam", "column", "hbrace", "vbrace"):
            raise ModelError(f"element {e['id']}: unsupported frame type {e.get('type')}")
        for end in ("endI", "endJ"):
            if e.get(end, {}).get("condition") != "rigid" or e[end].get("springSymbol"):
                raise ModelError(f"element {e['id']} ({e['sourceId']}/{e['sourceBranch']}) {end}: "
                                 "only explicit rigid ends supported; pins/springs are not inferred")
        material = materials.get(e.get("material"))
        if material is None:
            raise ModelError(f"element {e['id']}: missing material")
        section = sections[e["sectionId"]]
        values = [finite(section.get(k), f"section {section['id']}.{k}", True) for k in ("A", "J", "Iy", "Iz")]
        # Explicit shear areas are exchange data for Timoshenko consumers.
        # This elasticBeamColumn subset has no shear-deformation terms.
        for key in ("Ay", "Az", "Avy", "Avz"):
            if section.get(key) is not None:
                finite(section[key], f"section {section['id']}.{key}", True)
                if model.get("units", {}).get("shearArea") != "mm2":
                    raise ModelError("units.shearArea: expected mm2")
                ignored_shear_sections.add(section["id"])
        E, G = [finite(material.get(k), f"material {material['name']}.{k}", True) for k in ("E", "G")]
        orientation = axes(point(nodes[e["nodeI"]]), point(nodes[e["nodeJ"]]))
        prepared_elements.append({**e, "axes": orientation, "properties": [values[0], E, G, *values[1:]]})
        used.update((e["nodeI"], e["nodeJ"]))
    if used != set(nodes):
        raise ModelError(f"Nodes not connected to frame members: {sorted(set(nodes)-used)}")
    fixities = {n: [0]*6 for n in nodes}
    for support in indexed(model.get("supports"), "supports").values():
        if support.get("nodeId") not in nodes:
            raise ModelError(f"support {support['id']}: missing node")
        if any(not isinstance(support.get(k), bool) for k in DOFS):
            raise ModelError(f"support {support['id']}: six explicit boolean restraints required")
        fixities[support["nodeId"]] = [int(a or support[k]) for a, k in zip(fixities[support["nodeId"]], DOFS)]
    loads = {n: [0.]*6 for n in nodes}
    assignments = []
    for load in indexed(model.get("loads"), "loads").values():
        if load.get("loadCase") not in cases:
            raise ModelError(f"load {load['id']}: unknown loadCase")
        if load["loadCase"] != load_case:
            continue
        if load.get("type") != "pointLoad":
            raise ModelError(f"load {load['id']}: only pointLoad supported; distribute explicitly with F5")
        position = [finite(load.get(k), f"load {load['id']}.{k}") for k in ("x1", "y1", "z")]
        matches = [n for n in nodes if math.dist(position, point(nodes[n])) <= 1e-7]
        if len(matches) != 1:
            raise ModelError(f"load {load['id']}: expected exactly one coincident node (1e-7 mm), found {len(matches)}")
        node_id = matches[0]
        if "nodeId" in load and load["nodeId"] != node_id:
            raise ModelError(f"load {load['id']}: nodeId disagrees with coordinates")
        vector = [finite(load.get(k), f"load {load['id']}.{k}") for k in LOADS]
        loads[node_id] = [a+b for a, b in zip(loads[node_id], vector)]
        assignments.append({"loadId": load["id"], "sourceId": load.get("sourceId"), "nodeId": node_id, "values": vector})
    if not assignments:
        raise ModelError(f"No nodal loads in case {load_case}")
    warnings = (["Density self-weight explicitly omitted; this is a load-only analysis."]
                if mode == "fromDensity" else [])
    if ignored_shear_sections:
        warnings.append("Euler-Bernoulli elasticBeamColumn does not use shear areas Ay/Az/Avy/Avz "
                        "or shear deformation; sections: " + ", ".join(map(str, sorted(ignored_shear_sections))))
    return {"nodes": nodes, "elements": prepared_elements, "fixities": fixities, "loads": loads,
            "assignments": assignments, "loadCase": load_case, "selfWeight": mode,
            "warnings": warnings}


def commands(prepared):
    lines = ["ops.wipe()", "ops.model('basic', '-ndm', 3, '-ndf', 6)"]
    for tag, node in prepared["nodes"].items():
        lines.append(f"ops.node({tag}, {', '.join(map(repr, point(node)))})")
        fix = prepared["fixities"][tag]
        if any(fix):
            lines.append(f"ops.fix({tag}, {', '.join(map(str, fix))})")
    for e in prepared["elements"]:
        tag = e["id"]
        lines.append(f"ops.geomTransf('Linear', {tag}, {', '.join(map(repr, e['axes']['z']))})")
        args = [tag, e["nodeI"], e["nodeJ"], *e["properties"], tag]
        lines.append(f"ops.element('elasticBeamColumn', {', '.join(map(repr, args))})")
    lines.extend(["ops.timeSeries('Linear', 1)", "ops.pattern('Plain', 1, 1)"])
    for tag, values in prepared["loads"].items():
        if any(values):
            lines.append(f"ops.load({tag}, {', '.join(map(repr, values))})")
    lines.extend(["ops.constraints('Plain')", "ops.numberer('RCM')", "ops.system('ProfileSPD')",
                  "ops.test('NormDispIncr', 1e-10, 10)", "ops.algorithm('Linear')",
                  "ops.integrator('LoadControl', 1.0)", "ops.analysis('Static')"])
    return "\n".join(lines) + "\n"


def resultant(nodes, values):
    total = [0.]*6
    for tag, vector in values.items():
        moment = cross(point(nodes[tag]), vector[:3])
        total = [a+b for a, b in zip(total, vector[:3] + [vector[k+3]+moment[k] for k in range(3)])]
    return total


def solve(model, load_case, self_weight="error"):
    prepared = prepare(model, load_case, self_weight)
    import openseespy.opensees as ops
    try:
        exec(commands(prepared), {"ops": ops})  # Generated only from validated numeric values.
        status = ops.analyze(1)
        if status != 0:
            raise ModelError(f"OpenSees failed (status {status}); check mechanisms, restraints and stiffness conditioning")
        ops.reactions()
        displacements = {tag: list(ops.nodeDisp(tag)) for tag in prepared["nodes"]}
        reactions = {tag: list(ops.nodeReaction(tag)) for tag in prepared["nodes"]}
        for values in (*displacements.values(), *reactions.values()):
            if len(values) != 6 or not all(math.isfinite(v) for v in values):
                raise ModelError("Solver returned invalid/non-finite results")
        applied = resultant(prepared["nodes"], prepared["loads"])
        resisted = resultant(prepared["nodes"], reactions)
        residual = [a+b for a, b in zip(applied, resisted)]
        length = max(1., *(e["axes"]["length"] for e in prepared["elements"]))
        force_scale = max(1., sum(abs(v) for row in prepared["loads"].values() for v in row[:3]))
        moment_scale = max(1., force_scale*length, sum(abs(v) for row in prepared["loads"].values() for v in row[3:]),
                           *(abs(v) for v in applied[3:]))
        tolerance = [1e-6 + 1e-8*force_scale]*3 + [1e-4 + 1e-8*moment_scale]*3
        if any(abs(v) > tol for v, tol in zip(residual, tolerance)):
            raise ModelError(f"Global equilibrium failed: residual {residual}")
        element_results = []
        for e in prepared["elements"]:
            forces = list(ops.eleResponse(e["id"], "localForce"))
            if len(forces) != 12 or not all(math.isfinite(v) for v in forces):
                raise ModelError(f"element {e['id']}: invalid local forces")
            element_results.append({k: e[k] for k in ("id", "sourceId", "sourceBranch", "nodeI", "nodeJ", "axes")})
            element_results[-1]["localEndForces"] = forces
        return {"format": "element-modeler-analysis-result", "version": 1,
                "modelFingerprint": fingerprint(model), "fingerprintVersion": "typed-json-binary64-v1",
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "solver": {"name": "OpenSeesPy", "version": ops.version(), "analysis": "linear-static-3d-frame"},
                "loadCase": load_case, "status": "success", "warnings": prepared["warnings"],
                "units": {"translation": "mm", "rotation": "rad", "force": "N", "moment": "N*mm"},
                "coordinates": {"verticalAxis": "z", "handedness": "right"},
                "nodes": [{"id": tag, "position": point(node), "displacement": displacements[tag],
                           "reaction": reactions[tag]} for tag, node in prepared["nodes"].items()],
                "elements": element_results, "loadAssignments": prepared["assignments"],
                "equilibrium": {"applied": applied, "reactions": resisted, "residual": residual,
                                "tolerance": tolerance, "passed": True}}
    finally:
        ops.wipe()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--case", required=True, dest="load_case")
    parser.add_argument("--output", type=Path, help="Run OpenSeesPy and atomically write result JSON")
    parser.add_argument("--emit-python", type=Path, help="Write an inspectable, independently runnable OpenSeesPy script")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--self-weight", choices=("error", "omit"), default="error")
    args = parser.parse_args()
    try:
        targets = [p.resolve() for p in (args.output, args.emit_python) if p]
        if args.input.resolve() in targets or len(targets) != len(set(targets)):
            raise ModelError("Input and output paths must be distinct")
        model = read_model(args.input)
        prepared = prepare(model, args.load_case, args.self_weight)
        if not (args.output or args.emit_python or args.validate_only):
            parser.error("choose --output, --emit-python or --validate-only")
        if args.emit_python:
            script = ("# Generated from " + fingerprint(model) + "\nimport openseespy.opensees as ops\n" + commands(prepared) +
                      "status = ops.analyze(1)\nif status != 0:\n    raise RuntimeError(f'Analysis failed: {status}')\n" +
                      "ops.reactions()\nfor tag in ops.getNodeTags():\n    print(tag, ops.nodeDisp(tag), ops.nodeReaction(tag))\n")
            atomic_write(args.emit_python, script)
        if args.output and not args.validate_only:
            write_json(args.output, solve(model, args.load_case, args.self_weight))
        print(f"Validated {len(prepared['elements'])} frame elements; case {args.load_case}; {fingerprint(model)}")
        for warning in prepared["warnings"]:
            print("WARNING: " + warning, file=sys.stderr)
        return 0
    except (ValueError, KeyError, TypeError, OSError, ImportError, RuntimeError) as error:
        print(f"Analysis error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
