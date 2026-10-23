"""Physical invariants of the modal calculation; no artifact-calibration claim."""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from elastic_model import Material, geometry, solve, stiffness_mass


class ElasticModelTests(unittest.TestCase):
    def test_material_removal_reduces_mass_and_preserves_positive_thickness(self):
        base = geometry(0, 0, 0)
        cut = geometry(5, 5, 5)
        self.assertLess(cut['volume'], base['volume'])
        self.assertGreater(cut['min_thickness'], 0.002)

    def test_energy_matrices_have_exactly_six_free_body_modes(self):
        k, m = stiffness_mass(0, 0, 0, degree=3, z_degree=2)
        np.testing.assert_allclose(k, k.T, atol=1e-6)
        np.testing.assert_allclose(m, m.T, atol=1e-12)
        eig=np.linalg.eigvalsh(k)
        self.assertLess(np.max(np.abs(eig[:6])),eig[6]*1e-8)
        self.assertGreater(eig[6],0)
        self.assertGreater(np.linalg.eigvalsh(m)[0], 0)

    def test_material_scaling_obeys_elastic_eigenproblem(self):
        f, _ = solve(0, 0, 0, degree=3, z_degree=2)
        stiffer, _ = solve(0, 0, 0, degree=3, z_degree=2, material=Material(young=4e11))
        heavier, _ = solve(0, 0, 0, degree=3, z_degree=2, material=Material(density=35200))
        np.testing.assert_allclose(stiffer[:6], f[:6]*2, rtol=1e-7)
        np.testing.assert_allclose(heavier[:6], f[:6]/2, rtol=1e-7)

    def test_geometry_is_closed_almond_and_not_axisymmetric(self):
        g = geometry(0, 0, 0)
        ring = np.asarray(g['rings'][-1])
        self.assertGreater(np.ptp(ring[:,0]), np.ptp(ring[:,1])*1.4)
        self.assertLess(np.max(np.linalg.norm(np.diff(ring, axis=0), axis=1)), .02)


if __name__ == '__main__':
    unittest.main()
