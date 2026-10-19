# VYV fixed-price quoting: research and implementation specification

Research date: October 19, 2026. Status: engineering proposal with an internal cost-guard prototype. The currently published booking flow remains an hourly planning estimate. A fixed price has not been activated.

## Decision

Build an inventory-based, scope-locked quote with a three-person crew cost floor. Use home size to select the inventory template and detect missing rooms; do not assign the final price from bedroom count. Commit to one price for the confirmed inventory, services and access conditions. Normal overruns remain VYV's cost; changed customer scope requires a separately approved revision before additional work.

No public guide makes it possible to predict every VYV job exactly. A fixed customer invoice is achieved through a clear service commitment, review and adequate pricing—not perfect prediction of the finishing time. Keep actual time and crew payroll tracking for profit analysis even when customer billing is fixed.

## Research findings and evidence quality

| Evidence | Finding | Application |
|---|---|---|
| SmartMoving product documentation [1] | Room-size presets are for ballpark estimates; item-level inventories improve volume/weight accuracy. | Inventory determines work. Bedroom count starts the questionnaire. |
| HireAHelper first-party methodology [2] | Labor-only and full-service jobs have materially different durations and cost drivers. National averages are ballparks. | Do not use a load-only booking duration as a complete pickup-to-delivery time. |
| MovingLabor service planner [3] | Home size, loading vs unloading, stairs, carry distance, heavy items and readiness all matter. | Collect service type and access separately for every stop. |
| U-Haul planning guide [4] | Stairs and distance between truck and door can add substantial time. | Measure actual flights and carry distance. Its broad additive rules are not validated VYV coefficients. |
| RVA Movers, a Virginia operator [5] | Shared elevators, reservation rules, building hours and parking access create delays. | Replace the elevator yes/no toggle with operational questions. |
| U-Haul truck specification [6] | A listed 26-foot model has 1,682 cubic feet and a 12,859-pound maximum load; supplied equipment can vary. | Check usable volume, payload and dimensions of VYV's actual truck. Do not assume every three-bedroom house fits. |
| SmartMoving estimate workflow [7] | It supports inventory locking and estimate versions. | Keep an immutable quote snapshot; customer edits create a revision. |
| Virginia DMV and Virginia Code [8,9] | Carrier tariffs and estimate requirements apply; DMV specifically describes filed-rate requirements for deliveries over 30 miles. | Confirm VYV's operation, filed tariff and document form before changing customer billing to a binding flat amount. |
| FMCSA interstate guidance [10] | Written interstate estimates account for inventory/services and inspection; binding commitments depend on listed scope. | Route interstate moves into a separately reviewed process rather than applying Virginia-only assumptions. |

Published time tables vary by service and crew. HireAHelper's methodology reports national full-service averages of roughly four hours for a one-bedroom apartment with two movers, 4.5 hours for a two-bedroom apartment with two, and 5.5 hours for a three-bedroom apartment with three. These are not guarantees for VYV. Its separate crew guide contains a row whose loading and unloading columns total 6.5 hours while its total column says 7.5; that row is excluded as a numerical calibration source. More conservative VYV experience should take precedence over a mismatched national average.

## Inventory templates for every property size

| Property | Start with these rooms/areas | Required expansion checks |
|---|---|---|
| Studio | Sleeping/living area, kitchen, bath, closets | Balcony, storage locker, bulky combined furniture |
| One-bedroom apartment/house | Bedroom, living room, kitchen/dining, bath, closets | Office desk, packed closets, sectional, appliances, garage/shed if a house |
| Two-bedroom apartment/house | Two bedrooms plus shared rooms | Each bedroom's actual use: occupied room, office, nursery or storage; patio and extra closets |
| Three-bedroom apartment/house | Three bedrooms plus shared rooms | Second living space, basement, attic, garage, outdoor furniture, tools, gym equipment |
| Four bedrooms or larger | All listed rooms plus additional spaces | Capacity, additional truck/trip, crew limits, multi-day scheduling and full inventory review |
| Townhouse/multilevel | Appropriate room template plus floor assignment | Internal stairs for each item's start and destination, tight turns and basement exits |
| Storage | Unit dimensions and occupied percentage | Item inventory, stacking, restricted aisle/lift access; unit size alone does not define contents |

For every room: select furniture and box quantities; identify what is staying; distinguish packed contents from furniture; add custom dimensions/photos for unusual items. Do not simultaneously apply a full-house preset volume and add the same items again.

Furniture catalog records need dimensions/cubic feet, estimated weight or weight band, load/unload handling tasks, number of people needed for a lift, wrapping requirements, disassembly and reassembly tasks, and any specialist/equipment requirement. A sofa's cubic volume does not by itself describe a difficult stair carry. Custom items bypass standard assumptions and require review.

Count boxes by size/type, not just one total. Books, dishes, wardrobes and loose bags require different handling. Ask how many boxes the crew must pack or unpack. Include garages, sheds, attics, outdoor items and storage lockers explicitly. Photo/video confirmation should cover all rooms, closets and storage areas; a photograph is evidence for review, not automatic proof that nothing is hidden.

## Access and route model

Record independently at pickup, destination and each additional stop:

- Actual floor, exterior and interior flights used, narrow turns, stairs at loading dock or entrance, and the inventory carried along each path. A fourth-floor bedroom in a house is not the same as all inventory originating on the fourth floor.
- Truck-to-building distance, hallway distance, slope/surface and whether parking is reserved and legally usable by the planned truck.
- Elevator type: reserved freight, shared passenger, or unavailable. Record reservation window, dimensions, practical load/carry capacity, number of cars usable, cycle duration/wait, and whether large items fit.
- Loading dock access/hours, building restrictions, COI requirements, door/elevator measurements and shuttle/hoist needs.

Elevator timing should use estimated trips × cycle/wait time, not a fixed discount because the answer is “yes.” A dedicated freight lift can outperform stairs; a shared small lift can become the bottleneck. Quantities in each carry group drive trips. Do not count waiting both inside an access coefficient and as an added delay.

Use vehicle-appropriate routes and expected departure times where supported; a regular car-route API is not proof of truck clearance or unrestricted access. Include driving between all stops. Additional truck trips include repeated loading/unloading, route legs, fuel and paid time. Internally include paid dispatch, setup and return travel when VYV pays for them even if those are not separate customer line items. This does not change the current promise that no per-mile fee or separately billed return-to-base journey is added.

## Time model: real tasks rather than arbitrary stage percentages

Replace the current percentage split with task-level estimates for protection, disassembly, loading, inter-stop transport, unloading, placement, reassembly, packing and cleanup. Model carrying resources and bottlenecks: some tasks need two movers together; the third may wrap or organize the truck. Three movers do not complete every task 33% faster than two, and an elevator cannot be sped up by adding a worker.

Define coefficients by item category, access path and crew configuration; label provisional coefficients explicitly until actual jobs support them. Collect stage start/end, crew attendance, delays and inventory differences from completed VYV moves. Keep load and unload rates separate. Fit on completed jobs and evaluate predictions on different jobs; do not report fit on the same jobs as prediction accuracy.

Calculate a central estimate and a higher planning estimate from VYV error history. Choose the fixed-price risk allowance from that history and the owner's tolerance. Do not invent a statistical 90% confidence claim from five moves or assume a generic 20% buffer is sufficient. Track overrun frequency, monetary loss per overrun and contribution by move type. Review after each early job; increase automatic approval coverage only as the evidence supports it.

## Price that pays the crew and the business

Use actual loaded hourly costs for all three workers, including the driver's pay structure, applicable employer costs and overtime when relevant. Include owner labor if the owner is a crew member. Customer job hours and paid payroll hours can differ.

Operating job cost includes: loaded crew payroll for all paid hours; truck rental or allocated ownership cost; fuel across operational routing; materials; tolls/permits; paid specialists; equipment; allocated overhead; and variable operating costs. Account for costs once—do not duplicate fuel inside the truck allocation and again as fuel.

Add a documented contingency for expected overruns and incidents. Margin is different from markup. With no tax complication, the cost-based pre-tax target is:

`(operating cost + contingency + fixed processing fee) / (1 − target operating margin − payment processing fraction)`

If processing fees apply to collected taxes, include that fee effect. Apply only the tax treatment confirmed for the actual services. All customer-required charges must be represented in the fixed total before acceptance. Deposit is credited against that total rather than added to it. Any promotion must pass the same minimum-profit check after the discount.

This cost target is not a claim about what competitors charge or proof of market demand. Compare candidate offers to the existing retail rate reference and actual local like-for-like quotes, then measure conversion and job profitability. A third worker earns their place when they reduce time/safety risk or enable work; the productivity improvement must be measured for the work involved.

The internal prototype `fixed-quote-cost-core.js` implements the cost-floor arithmetic and review guards. It does not predict inventory handling or publish customer prices. It requires three loaded wages, verified inventory/access/capacity, reviewed time inputs, approved costs and a scope version. Missing information yields `review_required` with no price. Fictional fixture numbers in tests are not VYV costs.

## Customer promise and quote lifecycle

1. Customer enters move date/route and completes room inventory, packing and access details.
2. Customer sees a preliminary result while unverified details remain. Difficult/uncertain jobs receive review, not a fabricated guaranteed total.
3. Review confirms scope, truck/crew feasibility, tariff/rate treatment and cost floor. The server recalculates and stores a unique versioned quote with a price, included services, exclusions, expiry and snapshot/hash of the inventory/access.
4. Customer accepts that exact version. Deposit creation uses the server quote ID; the browser cannot select its own amount, wages, hours or final price.
5. Booking atomically reserves capacity and stores the quote ID. Payment/save retry uses idempotency keys. A paid booking with a temporary save failure enters reconciliation rather than encouraging a second payment.
6. Crew verifies inventory/access before loading. VYV absorbs normal extra time for unchanged scope. New customer-requested items/services create a revised scope for acceptance before that extra work; approved changes remain transparent. A “nothing can ever change” promise would mean VYV accepts even unlimited additions, which needs a deliberately different commercial policy.
7. Final invoice for unchanged scope equals the accepted quote total minus credits/deposit, regardless of the timer. Actual timer data feeds payroll and future estimation. Admin hourly completion logic must not overwrite a fixed quote or charge the deposit twice.

All offers need consistent website terms, confirmation, cancellation/refund treatment and written documents. Virginia intrastate and interstate requirements are distinct. This engineering specification does not establish VYV's existing authority/tariff details; those have not been supplied.

## Test and rollout requirements

Test: identical inventory in 1BR vs 2BR homes does not change price solely because of the bedroom label; denser inventory raises tasks/capacity; elevators affect the correct stop only; packing does not double-count handling; one load exceeds volume/payload limits; item too large/heavy cannot auto-approve; nonconsecutive/multiday payroll; overtime; empty/missing input; deposit/discount/tax math; quote changes after acceptance; tampered browser price; expired quote; concurrent bookings; Stripe declines/3DS; paid save retry; final invoice matching accepted fixed scope.

Deploy the server security repair before storing approval controls or sensitive cost settings. Keep real wages and margin settings server-side. Run the fixed model in shadow alongside current reviewed quotes, compare to completed jobs, then enable owner-reviewed fixed offers for verified simple jobs. Automatic fixed offers require a validated model and cost settings; no bedroom-only guarantee should be enabled now.

## Inputs needed from the owner

- Pay for each of the three movers, whether/how travel is paid, and driver/owner participation.
- Actual truck type/usable capacity and rental/ownership, fuel, equipment and materials costs.
- Minimum operating margin or minimum contribution per job; how promotions are funded.
- A few completed moves with inventory, access, crew size, loading/drive/unloading hours and actual costs. More completed jobs improve calibration; a small sample supports review, not an accuracy guarantee.
- Applicable rate/tariff documents and the intended fixed-scope/change policy.

## Sources

[1] SmartMoving: https://help.smartmoving.com/en/articles/6219601-determine-a-move-s-volume-and-weight

[2] HireAHelper first-party methodology: https://www.hireahelper.com/advice/cost-methodology/

[3] MovingLabor planner: https://movinglabor.com/tools/crew-size-time-estimator/

[4] U-Haul time guide: https://www.uhaul.com/Tips/Packing/How-Many-Hours-Do-I-Need-for-Moving-Help-Providers-16049/

[5] RVA Movers apartment access: https://rvamovers.com/resources/apartment-moving-guide/

[6] U-Haul 26-foot specifications: https://www.uhaul.com/Truck-Rentals/26ft-Moving-Truck/

[7] SmartMoving quote/inventory versions: https://help.smartmoving.com/en/articles/6213202-estimate-overview

[8] Virginia DMV household goods: https://www.dmv.virginia.gov/businesses/motor-carriers/intrastate/house-goods

[9] Virginia Code §46.2-2157: https://law.lis.virginia.gov/vacode/title46.2/chapter21/section46.2-2157/

[10] FMCSA interstate estimates: https://www.fmcsa.dot.gov/consumer-protection/protect-your-move/what-binding-move-estimate

Additional cross-check, with inconsistent row excluded: https://www.hireahelper.com/advice/how-many-movers-do-you-really-need/
