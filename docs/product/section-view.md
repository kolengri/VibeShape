# Section view

The modeling viewport offers **Section view** when solid meshes are visible. Enable clipping,
select a normal axis (X/Y/Z), enter a finite world-coordinate offset in millimeters, and choose
which side to retain. Enabling or changing the axis starts at the visible model's midpoint.
Invalid offsets leave the last valid plane active and show an input error.

This is a local view setting. Cut surfaces remain open; clipping does not construct capped solids,
modify model history, persist a cutting feature, or affect STEP/STL/3MF exports. Clipped portions
cannot be selected through ordinary model picking. Printer decorations and origin planes remain
visible. Active sketch and feature previews suspend clipping, then restore the selected view.
Reloading the workspace clears the section.

Use [Split body](split-body.md) when separately owned, exportable pieces are required.
