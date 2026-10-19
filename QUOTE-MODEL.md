# VYV estimated move total — planning model v1

The quote screen appears after packing selection and before checkout. Six progress milestones span eight form panels. The quote and checkout show the same estimated range, and the paid booking's notes retain the snapshot for customer conversations.

## Research basis

Sources checked October 19, 2026:

- Haul Bros Moving, Northern Virginia: https://www.haulbrosmoving.com/blog/how-long-does-a-local-move-take/ — broad local planning ranges, including 3–5 hours for a prepared one-bedroom with two movers. Its guide explicitly says these are synthesized planning ranges, not measured job averages.
- Lift & Chill, DC/MD/VA: https://www.liftnchillmoving.com/answers — one-bedroom 3–5 hours, two-bedroom 5–7 hours, with local driving included in its guidance.

Both providers emphasize inventory, preparation and access. These are reference points, not VYV historical productivity data. Exact multipliers below are transparent VYV implementation assumptions that should be calibrated against completed jobs. No fixed four-hour cap is imposed.

## Calculation

- Initial handling range for two movers by bedroom/size tier: studio 2.5–4, one bedroom 3–5, two bedrooms 4.5–7, three bedrooms 7–11, four bedrooms 10–15, five-plus 12–18 hours. Use the larger size tier when bedrooms and square footage disagree. Storage has a unit-size mapping. Missing home size is flagged for crew review.
- This model separates estimated driving from handling: route distance includes every stop, with planning speeds of 35 mph at the low end and 20 mph at the high end, minimum 0.25–0.5 hours. These speeds do not represent live traffic. As a result, even a standard one-bedroom estimate may exceed the guides' 3–5 hour reference range.
- Three movers reduce the handling component by 15%; driving and access allowances remain. This is an assumption, not a guarantee that a larger crew always finishes faster.
- Volume multipliers: everything 1, most 0.9, half 0.7, few 0.45. Inventory density: light 0.85, normal 1, heavy 1.35. Optional box count can raise the density allowance. Floor/stair and elevator allowances apply to every location. Garage contents, specialty handling, extra stops and a long carry add time; they do not add separate specialty-item fees.
- Moving time is rounded up to a quarter-hour with the existing two-hour minimum. Upper estimates above 12 hours, five-plus-bedroom moves and incomplete packing readiness prompt crew review.
- Moving labor = low/high moving hours × the selected date's existing crew hourly rate.
- Truck fee uses the existing business rule: $99 at 50 miles or less across the move route, $125 above 50 miles. Deposit uses distance from Fredericksburg to pickup: $250 within 50 miles, $300 beyond.
- Optional packing uses a separate estimated time range, a two-hour minimum, and the three-packer rate for the selected packing date. It is included in the total only when selected. Packing materials and unlisted charges are excluded and stated on-screen.
- Estimated total = moving labor + truck fee + selected packing labor. Estimated remaining balance = max(0, estimated total − deposit). Deposit is not added again.

## Scope and validation

This is an estimated range for planning, not a binding quote or a maximum price. Extra trips, undisclosed inventory and difficult access can exceed it. Owner review is recommended for large/complex jobs and this first version should be calibrated using actual VYV hours before being represented as a precise prediction.

Route failure disables continuing to checkout until addresses/pricing are resolved. Pricing for quotes remains browser-calculated; the server still needs authoritative recalculation before automated final charging can trust browser-supplied values.

Tests cover full one-bedroom inventory, destination stairs, extra stops, packing, crew size, travel, deposit credit, missing inputs, and forward/back navigation. No paid live transaction was performed.
