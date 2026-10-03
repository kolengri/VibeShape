# Topology measurements

The **Measure** task includes local topology inspection for an exact selected body output. Choose
an edge or face in the element catalog to see native edge length or face area. Circular and arc
edges also expose diameter from their analytical radius. These values come from the validated
current B-Rep rebuild; display polylines and mesh triangles are not measurement inputs.

Enable **Compare with another element** and select a measurement point on each element. Available
points are analytical line endpoints, arc endpoints/midpoints, curve centers, and native centroids.
The result is the spatial distance between the two named points, not minimum shape distance.

Straight lines and planar faces can show an acute angle between their directions or normals.
Parallel planar faces additionally show separation between their infinite supporting planes,
with an angular numerical tolerance of `1e-9` radians. This value does not measure clearance
between bounded face patches. Curved-face or general-curve pair distances are not approximated
from tessellation or centroids.

Length, area and angle use the document's display units. Selections are view state, reset when
body/revision/rebuild evidence changes, and never persist candidate IDs as topology references.
Stale, missing, invalid or incomplete exact geometry makes inspection unavailable.
