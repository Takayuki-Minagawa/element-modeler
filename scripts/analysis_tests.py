#!/usr/bin/env python3
"""Run core, real OpenSees, and real IfcOpenShell acceptance tests separately."""
import argparse
import copy
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from analysis_common import ModelError, fingerprint, read_model
from analysis_demo import cantilever
from analysis_opensees import prepare, solve

ROOT = Path(__file__).resolve().parent.parent


class CoreTests(unittest.TestCase):
    def test_fixture_reproducible(self):
        self.assertEqual(cantilever(), read_model(ROOT / "test/fixtures/analysis/rigid-cantilever.json"))

    def test_fingerprint_python_javascript_identical(self):
        model = cantilever()
        model["extra"] = {"日本語😀": [1e-12, -0.0, True, None, "line\nquote\""], "𐀀": 1, "\ue000": 2}
        script = "import {modelFingerprint} from './js/analysis/fingerprint.js'; console.log(await modelFingerprint(JSON.parse(process.argv[1])));"
        output = subprocess.check_output(["node", "--input-type=module", "-e", script, json.dumps(model)], cwd=ROOT, text=True)
        self.assertEqual(output.strip(), fingerprint(model))
        original = fingerprint(model)
        model["meta"]["generatedAt"] = "different time"
        model["meta"]["generator"] = {"version": "different version"}
        self.assertEqual(original, fingerprint(model))
        model["elements"][0]["sourceBranch"] = "cross"
        self.assertNotEqual(original, fingerprint(model))

    def test_unsupported_and_invalid_models_rejected(self):
        changes = [
            lambda m: m["elements"][0]["endI"].update(condition="pin"),
            lambda m: m["elements"][0]["endJ"].update(condition="spring", springSymbol="s"),
            lambda m: m["loads"][0].update(type="areaLoad"),
            lambda m: m["loads"][0].update(x1=2999.99),
            lambda m: m["materials"][0].update(E=None),
            lambda m: m["sections"][0].update(J=-1),
            lambda m: m["supports"][0].update(dx=1),
            lambda m: m["nodes"].append({"id": 3, "x": 1, "y": 2, "z": 3}),
            lambda m: m["elements"][0].update(nodeJ=1),
            lambda m: m["elements"][0].update(sectionRotation=90),
            lambda m: m["units"].update(length="m"),
            lambda m: m["loads"][0].update(nodeId=1),
            lambda m: m["loads"][0].update(fz=float("nan")),
        ]
        for change in changes:
            with self.subTest(change=change):
                model = cantilever(); change(model)
                with self.assertRaises(ModelError):
                    prepare(model, "LL")

    def test_explicit_self_weight_omission(self):
        model = cantilever(); model["selfWeight"]["mode"] = "fromDensity"
        with self.assertRaisesRegex(ModelError, "self-weight"):
            prepare(model, "LL")
        self.assertTrue(prepare(model, "LL", "omit")["warnings"])

    def test_shear_areas_are_validated_and_reported_as_unused(self):
        baseline = prepare(cantilever(), "LL")
        self.assertFalse(baseline["warnings"])
        for key in ("Ay", "Az", "Avy", "Avz"):
            with self.subTest(key=key):
                model = cantilever()
                model["units"]["shearArea"] = "mm2"
                model["sections"][0][key] = 12000
                prepared = prepare(model, "LL")
                self.assertEqual(prepared["elements"][0]["properties"], baseline["elements"][0]["properties"])
                self.assertEqual(len(prepared["warnings"]), 1)
                self.assertIn("does not use shear areas", prepared["warnings"][0])
                for invalid in (0, -1, True, "12000", float("inf")):
                    model["sections"][0][key] = invalid
                    with self.assertRaises(ModelError):
                        prepare(model, "LL")
                model["sections"][0][key] = 12000
                model["units"]["shearArea"] = "m2"
                with self.assertRaisesRegex(ModelError, "units.shearArea"):
                    prepare(model, "LL")

    def test_directional_springs_are_not_silently_treated_as_rigid_ends(self):
        model = cantilever()
        model["springs"] = [{"symbol": "S", "kr": None, "krY": "rigid", "krZ": "rigid", "kt": None}]
        model["elements"][0]["endI"].update(condition="spring", springSymbol="S")
        with self.assertRaisesRegex(ModelError, "only explicit rigid ends"):
            prepare(model, "LL")

    def test_duplicate_keys_fail(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "bad.json"
            path.write_text('{"nodes": [], "nodes": []}')
            with self.assertRaisesRegex(ModelError, "Duplicate"):
                read_model(path)

    def test_failed_cli_preserves_existing_result(self):
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder) / "model.json", Path(folder) / "result.json"
            model = cantilever(); model["elements"][0]["endI"]["condition"] = "pin"
            source.write_text(json.dumps(model)); output.write_text("previous result")
            process = subprocess.run([sys.executable, str(ROOT / "scripts/analysis_opensees.py"), str(source),
                                      "--case", "LL", "--output", str(output)], capture_output=True, text=True)
            self.assertEqual(process.returncode, 2)
            self.assertIn("only explicit rigid", process.stderr)
            self.assertEqual(output.read_text(), "previous result")

    def test_distributed_js_export_accepted_by_converter(self):
        script = """
import {previewLineLoad,previewToPointLoads} from './js/analysis/load-distribution.js';
const m=JSON.parse(process.argv[1]);
const p=previewLineLoad(m,{elementId:1,start:[0,0,0],end:[3000,0,0],intensity:[0,0,-1],loadCase:'LL',sourceId:'line1'});
m.loads=previewToPointLoads(p,{acknowledgeLumping:true});
console.log(JSON.stringify(m));
"""
        output = subprocess.check_output(["node", "--input-type=module", "-e", script, json.dumps(cantilever())], cwd=ROOT, text=True)
        prepared = prepare(json.loads(output), "LL")
        self.assertEqual(prepared["loads"][1][2], -1500)
        self.assertEqual(prepared["loads"][2][2], -1500)


class SolverTests(unittest.TestCase):
    def close(self, actual, expected):
        self.assertTrue(math.isclose(actual, expected, rel_tol=1e-8, abs_tol=1e-8), (actual, expected))

    def test_cantilever_bending_axial_torsion_both_axes(self):
        model = cantilever()
        model["loads"][0].update(fx=1200, fy=700, fz=-1000, mx=2300)
        result = solve(model, "LL")
        d = result["nodes"][1]["displacement"]
        E, G = 205000, 79000
        s = model["sections"][0]; L = 3000
        for actual, expected in zip(d, [1200*L/(E*s["A"]), 700*L**3/(3*E*s["Iz"]),
                                       -1000*L**3/(3*E*s["Iy"]), 2300*L/(G*s["J"]),
                                       1000*L**2/(2*E*s["Iy"]), 700*L**2/(2*E*s["Iz"])]):
            self.close(actual, expected)
        self.assertTrue(result["equilibrium"]["passed"])
        self.assertEqual(result["elements"][0]["sourceId"], "DEMO-B1")
        self.assertEqual(result["elements"][0]["sourceBranch"], "primary")

    def test_simply_supported_center_point_load(self):
        model = cantilever()
        model["nodes"].append({"id": 3, "x": 6000, "y": 0, "z": 0})
        e = copy.deepcopy(model["elements"][0]); e.update(id=2, sourceId="DEMO-B2", nodeI=2, nodeJ=3)
        model["elements"].append(e)
        model["supports"][0].update(ry=False, rz=False)
        model["supports"].append({"id": 2, "sourceId": "S2", "nodeId": 3, "dx": False, "dy": True, "dz": True,
                                  "rx": False, "ry": False, "rz": False})
        result = solve(model, "LL")
        self.close(result["nodes"][1]["displacement"][2], -1000*6000**3/(48*205000*model["sections"][0]["Iy"]))
        self.close(result["nodes"][0]["reaction"][2], 500)
        self.close(result["nodes"][2]["reaction"][2], 500)
        self.close(result["nodes"][0]["reaction"][4], 0)

    def test_small_L_frame_analytical_solution(self):
        model = cantilever(); H, L, P = 3000, 2000, 1000
        model["nodes"][1].update(x=0, z=H)
        model["nodes"].append({"id": 3, "x": L, "y": 0, "z": H})
        model["elements"][0].update(type="column")
        e = copy.deepcopy(model["elements"][0]); e.update(id=2, type="beam", sourceId="B2", nodeI=2, nodeJ=3)
        model["elements"].append(e)
        model["loads"][0].update(x1=L, z=H, fx=P, fz=0)
        result = solve(model, "LL")
        s = model["sections"][0]; E = 205000
        self.close(result["nodes"][2]["displacement"][0], P*H**3/(3*E*s["Iz"])+P*L/(E*s["A"]))
        self.close(result["nodes"][2]["displacement"][2], -L*P*H**2/(2*E*s["Iz"]))
        self.close(result["nodes"][0]["reaction"][4], -P*H)

    def test_inclined_member_axial_solution(self):
        model = cantilever(); end = [1000, 2000, 3000]; L = math.sqrt(sum(v*v for v in end))
        model["nodes"][1].update(zip(("x", "y", "z"), end))
        model["loads"][0].update(zip(("x1", "y1", "z"), end))
        model["loads"][0].update(zip(("fx", "fy", "fz"), [1000*v/L for v in end]))
        result = solve(model, "LL")
        for actual, component in zip(result["nodes"][1]["displacement"][:3], end):
            self.close(actual, 1000*component/(205000*20000))

    def test_mechanism_fails_without_success_result(self):
        model = cantilever(); model["supports"] = []
        with self.assertRaises((ModelError, RuntimeError)):
            solve(model, "LL")

    def test_load_at_fixed_node_reactions_include_applied_load(self):
        model = cantilever()
        second = copy.deepcopy(model["loads"][0]); second.update(id=2, x1=0, fz=-500)
        model["loads"].append(second)
        result = solve(model, "LL")
        self.close(result["nodes"][0]["reaction"][2], 1500)
        self.close(result["nodes"][0]["reaction"][4], -3000000)

    def test_F5_nodal_export_runs_in_real_solver(self):
        script = """
import {previewLineLoad,previewToPointLoads} from './js/analysis/load-distribution.js';
import {distributedAnalysisModel} from './js/analysis/workbench.js';
const m=JSON.parse(process.argv[1]);
m.loads=[{id:1,sourceId:'line1',type:'lineLoad',loadCase:'LL',x1:0,y1:0,x2:3000,y2:0,z:0,value:1}];
const p=previewLineLoad(m,{elementId:1,start:[0,0,0],end:[3000,0,0],intensity:[0,0,-1],loadCase:'LL',sourceId:'line1'});
console.log(JSON.stringify(await distributedAnalysisModel(m,1,previewToPointLoads(p,{acknowledgeLumping:true}))));
"""
        output = subprocess.check_output(["node", "--input-type=module", "-e", script, json.dumps(cantilever())], cwd=ROOT, text=True)
        model = json.loads(output)
        self.assertIn("sourceModelFingerprint", model["meta"])
        result = solve(model, "LL")
        self.close(result["nodes"][0]["reaction"][2], 3000)
        self.close(result["nodes"][0]["reaction"][4], -4500000)
        self.close(result["nodes"][1]["displacement"][2], -1500*3000**3/(3*205000*model["sections"][0]["Iy"]))


class IfcTests(unittest.TestCase):
    def test_profiles_storeys_coordinates_and_stable_guids(self):
        import ifcopenshell
        from analysis_ifc import export_ifc, validate_export
        model = cantilever()
        model["levels"].append({"id": "L1", "name": "1階", "z": 3000})
        model["nodes"].extend([{"id": 3, "x": 3000, "y": 0, "z": 3000},
                               {"id": 4, "x": 5000, "y": 1000, "z": 4000}])
        for identity, shape in ((2, "hSection"), (3, "boxSection")):
            model["sections"].append({"id": identity, "name": shape, "shape": shape, "b": 150, "h": 300,
                                      "flangeThickness": 12, "webThickness": 8, "boxThickness": 10})
            e = copy.deepcopy(model["elements"][0])
            e.update(id=identity, sourceId=f"M{identity}", type="column" if identity == 2 else "beam",
                     nodeI=identity, nodeJ=identity+1, sectionId=identity, levelId="L0" if identity == 2 else "L1")
            model["elements"].append(e)
        f, report = export_ifc(model, "test-project-identity")
        self.assertIn("web-ifc 0.0.77", report["consumerWarnings"][0])
        f = ifcopenshell.file.from_string(f.to_string())
        checks = validate_export(f, report)
        self.assertTrue(checks["geometryVolumes"])
        original = [m["guid"] for m in report["members"]]
        model["nodes"][3]["x"] += 500
        _, report2 = export_ifc(model, "test-project-identity")
        self.assertEqual(original, [m["guid"] for m in report2["members"]])
        _, report3 = export_ifc(model, "another-project")
        self.assertNotEqual(original, [m["guid"] for m in report3["members"]])
        product = f.by_guid(original[0]); product.ObjectPlacement.RelativePlacement.Location.Coordinates = (100., 0., 0.)
        with self.assertRaisesRegex(ModelError, "coordinate"):
            validate_export(f, report)

    def test_unsupported_and_bad_profiles_rejected(self):
        from analysis_ifc import export_ifc
        for change in (lambda m: m["elements"][0].update(type="vbrace"),
                       lambda m: m["sections"][0].update(shape="circle"),
                       lambda m: m["sections"][0].update(shape="boxSection", boxThickness=60),
                       lambda m: m["elements"][0].update(levelId="missing")):
            model = cantilever(); change(model)
            with self.assertRaises(ModelError):
                export_ifc(model, "test")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=("core", "opensees", "ifc", "all"), default="all")
    args = parser.parse_args()
    suites = {"core": CoreTests, "opensees": SolverTests, "ifc": IfcTests}
    classes = suites.values() if args.suite == "all" else [suites[args.suite]]
    suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(cls) for cls in classes)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
