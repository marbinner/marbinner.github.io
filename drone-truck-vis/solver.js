/**
 * Solver.js — Computational Engine for Truck & Drones Solution Editor
 *
 * Pure JavaScript port of the Python server-side logic.
 * Exposed as global `Solver` object. No DOM access.
 */

const Solver = (() => {
    const N_DRONES = 2;
    const DEPOT_INDEX = 0;

    // ========================================================================
    // Problem Parsing
    // ========================================================================

    /**
     * Parse problem text (same format as Python parse_problem).
     * Returns { nCustomers, droneLimit, truckMatrix, droneMatrix }
     */
    function parseProblemText(text) {
        const lines = text.split(/\r?\n/);
        let idx = 0;

        // Skip comments
        while (idx < lines.length && lines[idx].startsWith('#')) idx++;
        const nCustomers = parseInt(lines[idx].trim());
        idx++;

        while (idx < lines.length && lines[idx].startsWith('#')) idx++;
        const droneLimit = parseFloat(lines[idx].trim());
        idx++;

        while (idx < lines.length && lines[idx].startsWith('#')) idx++;

        const n = nCustomers + 1;
        const truckMatrix = [];
        for (let i = 0; i < n; i++) {
            const row = lines[idx].trim().split(/\t+/).map(Number);
            truckMatrix.push(row);
            idx++;
        }

        while (idx < lines.length && lines[idx].startsWith('#')) idx++;

        const droneMatrix = [];
        for (let i = 0; i < n; i++) {
            if (idx >= lines.length) break;
            let line = lines[idx].trim();
            if (line.startsWith('#') || !line) { idx++; i--; continue; }
            const row = line.split(/\t+/).map(Number);
            droneMatrix.push(row);
            idx++;
        }

        return { nCustomers, droneLimit, truckMatrix, droneMatrix };
    }

    // ========================================================================
    // MDS (Classical / Torgerson)
    // ========================================================================

    /**
     * SMACOF MDS embedding to 2D (matches scikit-learn's MDS).
     * Input: distance matrix (can be asymmetric — we symmetrize).
     * Returns coords as [[x,y], ...] centered on depot (index 0).
     */
    function classicalMDS(distMatrix) {
        const n = distMatrix.length;

        // 1. Symmetrize
        const delta = Array.from({ length: n }, (_, i) =>
            Array.from({ length: n }, (_, j) =>
                (distMatrix[i][j] + distMatrix[j][i]) / 2
            )
        );

        // 2. Initialize with deterministic seeded random positions
        // Use a simple LCG PRNG with seed=42 for reproducibility
        let seed = 42;
        function nextRand() {
            seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
            return seed / 0x7fffffff;
        }
        const X = Array.from({ length: n }, () => [nextRand() - 0.5, nextRand() - 0.5]);

        // 3. SMACOF iterations
        const maxIter = 300;
        const eps = 1e-6;
        let prevStress = Infinity;

        for (let iter = 0; iter < maxIter; iter++) {
            // Compute current pairwise distances in embedding
            const dist = Array.from({ length: n }, () => new Float64Array(n));
            for (let i = 0; i < n; i++) {
                for (let j = i + 1; j < n; j++) {
                    const dx = X[i][0] - X[j][0];
                    const dy = X[i][1] - X[j][1];
                    const d = Math.sqrt(dx * dx + dy * dy);
                    dist[i][j] = d;
                    dist[j][i] = d;
                }
            }

            // Compute stress
            let stress = 0;
            for (let i = 0; i < n; i++) {
                for (let j = i + 1; j < n; j++) {
                    const diff = dist[i][j] - delta[i][j];
                    stress += diff * diff;
                }
            }

            // Check convergence
            if (prevStress !== Infinity && Math.abs(prevStress - stress) / (prevStress || 1) < eps) {
                break;
            }
            prevStress = stress;

            // Guttman transform: compute B matrix and update X
            // B[i][j] = -delta[i][j] / dist[i][j]  if i != j and dist > 0
            // B[i][i] = -sum(B[i][j] for j != i)
            const newX = Array.from({ length: n }, () => [0, 0]);

            for (let i = 0; i < n; i++) {
                let sumB = 0;
                for (let j = 0; j < n; j++) {
                    if (i === j) continue;
                    const d = dist[i][j];
                    const b = d > 1e-10 ? -delta[i][j] / d : 0;
                    newX[i][0] += b * X[j][0];
                    newX[i][1] += b * X[j][1];
                    sumB += b;
                }
                // B[i][i] = -sumB
                newX[i][0] += (-sumB) * X[i][0];
                newX[i][1] += (-sumB) * X[i][1];
                newX[i][0] /= n;
                newX[i][1] /= n;
            }

            // Update positions
            for (let i = 0; i < n; i++) {
                X[i][0] = newX[i][0];
                X[i][1] = newX[i][1];
            }
        }

        // 4. Center on depot
        const dx = X[0][0], dy = X[0][1];
        for (let i = 0; i < n; i++) {
            X[i][0] -= dx;
            X[i][1] -= dy;
        }

        return X;
    }

    /**
     * Compute drone range in MDS space (for rendering the range circle).
     */
    function computeDroneRangeMds(coords, droneMatrix, droneLimit) {
        const n = coords.length;
        const mdsDistances = [];
        const droneTimes = [];
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const d = Math.sqrt(
                    (coords[i][0] - coords[j][0]) ** 2 +
                    (coords[i][1] - coords[j][1]) ** 2
                );
                const t = droneMatrix[i][j];
                if (t > 0 && d > 0) {
                    mdsDistances.push(d);
                    droneTimes.push(t);
                }
            }
        }
        let sumRatio = 0;
        for (let i = 0; i < mdsDistances.length; i++) {
            sumRatio += mdsDistances[i] / droneTimes[i];
        }
        const scale = sumRatio / mdsDistances.length;
        return (droneLimit / 2) * scale;
    }

    // ========================================================================
    // Solution Parsing
    // ========================================================================

    /**
     * Parse a solution string into components (matches Python parse_solution).
     */
    function parseSolution(solutionStr) {
        let s = solutionStr.trim()
            .replace(/,\|,/g, '|')
            .replace(/,\|/g, '|')
            .replace(/\|,/g, '|');
        const parts = s.split('|');
        if (parts.length !== 4) {
            throw new Error(`Expected 4 pipe-separated parts, got ${parts.length}`);
        }

        function ints(part) {
            return part.split(',').filter(c => c.trim()).map(c => parseInt(c.trim()));
        }

        return {
            truck_route: ints(parts[0]),
            drone_customers: ints(parts[1]),
            launch_positions: ints(parts[2]),
            land_positions: ints(parts[3]),
        };
    }

    // ========================================================================
    // Validation (port of FeasibiltyCheck.py + CalCulateTotalArrivalTime.py)
    // ========================================================================

    function isValidCell(cell, part1) {
        return cell >= 1 && cell <= part1.length;
    }

    function getCustomerFromCell(cell, part1) {
        if (!isValidCell(cell, part1)) return -1;
        return part1[cell - 1];
    }

    function getTripsPerDrone(solution) {
        const part2 = solution.part2;
        const part3 = solution.part3;
        const part4 = solution.part4;

        const part3Clean = part3.filter(x => x !== -1);
        const part4Clean = part4.filter(x => x !== -1);
        const nonSepCount = part2.filter(x => x !== -1).length;

        if (part3Clean.length !== nonSepCount || part4Clean.length !== nonSepCount) {
            throw new Error(
                `Inconsistent parts: part2 has ${nonSepCount} non-separator items, ` +
                `but part3 has ${part3Clean.length} and part4 has ${part4Clean.length} cleaned entries.`
            );
        }

        const tripsPerDrone = Array.from({ length: N_DRONES }, () => []);
        let droneIdx = 0;
        let cleanIdx = 0;

        for (const item of part2) {
            if (item === -1) {
                droneIdx++;
                continue;
            }
            if (droneIdx >= N_DRONES) droneIdx = N_DRONES - 1;
            tripsPerDrone[droneIdx].push([
                parseInt(part3Clean[cleanIdx]),
                parseInt(part4Clean[cleanIdx]),
            ]);
            cleanIdx++;
        }

        while (tripsPerDrone.length < N_DRONES) tripsPerDrone.push([]);
        return tripsPerDrone.slice(0, N_DRONES);
    }

    function getDroneRoutesFromParts(solution) {
        const part2 = solution.part2;
        const routes = Array.from({ length: N_DRONES }, () => []);
        let droneIdx = 0;

        for (const item of part2) {
            if (item === -1) {
                droneIdx++;
                continue;
            }
            if (droneIdx >= N_DRONES) droneIdx = N_DRONES - 1;
            routes[droneIdx].push(parseInt(item));
        }
        return routes;
    }

    function isTruckRouteFeasible(solution, nNodes) {
        const part1 = solution.part1;
        if (!part1 || part1.length < 2) return false;
        if (part1[0] !== DEPOT_INDEX || part1[part1.length - 1] !== DEPOT_INDEX) return false;
        for (const node of part1) {
            if (node < 0 || node >= nNodes) return false;
        }
        for (let i = 1; i < part1.length - 1; i++) {
            if (part1[i] === DEPOT_INDEX) return false;
        }
        return true;
    }

    function isCompleteSolution(solution, nNodes) {
        const part1 = solution.part1;
        const part2 = solution.part2;

        const truckCustomers = part1.filter(c => c !== DEPOT_INDEX);
        const droneCustomers = part2.filter(x => x !== -1);

        if (droneCustomers.some(c => c === DEPOT_INDEX)) return false;
        if (part2.filter(x => x === -1).length > N_DRONES - 1) return false;
        if (solution.part3.filter(x => x === -1).length > N_DRONES - 1) return false;
        if (solution.part4.filter(x => x === -1).length > N_DRONES - 1) return false;

        const freq = {};
        for (const c of truckCustomers) freq[c] = (freq[c] || 0) + 1;
        for (const c of droneCustomers) freq[c] = (freq[c] || 0) + 1;

        const expectedCustomers = new Set();
        for (let c = 1; c < nNodes; c++) expectedCustomers.add(c);

        if (Object.keys(freq).length !== expectedCustomers.size) return false;
        for (const c of expectedCustomers) {
            if (freq[c] !== 1) return false;
        }
        for (const c of Object.keys(freq)) {
            if (!expectedCustomers.has(parseInt(c))) return false;
        }

        return true;
    }

    function arePartsConsistent(solution, nNodes) {
        const part1 = solution.part1;
        const part2 = solution.part2;
        const part3 = solution.part3;
        const part4 = solution.part4;

        if (part2.filter(x => x !== -1).some(x => x === DEPOT_INDEX)) return false;
        if (part3.length !== part4.length) return false;

        try {
            getTripsPerDrone(solution);
        } catch (e) {
            return false;
        }

        const sep2 = part2.filter(x => x === -1).length;
        const sep3 = part3.filter(x => x === -1).length;
        const sep4 = part4.filter(x => x === -1).length;

        if ((sep3 > 0 && sep3 !== sep2) || (sep4 > 0 && sep4 !== sep2)) return false;

        const part3Clean = part3.filter(x => x !== -1);
        const part4Clean = part4.filter(x => x !== -1);
        if (part3Clean.length !== part4Clean.length) return false;

        for (let i = 0; i < part2.length; i++) {
            const lc = part3[i];
            const cust = part2[i];
            const rc = part4[i];

            if (cust === -1 && lc === -1 && rc === -1) continue;
            if (lc === -1 || rc === -1 || cust === -1) return false;

            const launchCell = parseInt(lc);
            const reconveneCell = parseInt(rc);
            if (isNaN(launchCell) || isNaN(reconveneCell)) return false;

            if (!isValidCell(launchCell, part1)) return false;
            if (!isValidCell(reconveneCell, part1)) return false;
            if (launchCell >= reconveneCell) return false;
        }

        return true;
    }

    function isFeasibleDroneTrip(customer, launchCell, reconveneCell, solution, droneMatrix, flightRange) {
        const part1 = solution.part1;
        if (!isValidCell(launchCell, part1) || !isValidCell(reconveneCell, part1)) return false;
        if (launchCell >= reconveneCell) return false;

        const launchCustomer = getCustomerFromCell(launchCell, part1);
        const reconveneCustomer = getCustomerFromCell(reconveneCell, part1);

        const flightTime = droneMatrix[launchCustomer][customer] + droneMatrix[customer][reconveneCustomer];
        return flightTime <= flightRange;
    }

    function areAllDroneTripsFeasible(solution, droneMatrix, flightRange) {
        let tripsPerDrone;
        try {
            tripsPerDrone = getTripsPerDrone(solution);
        } catch (e) {
            return false;
        }

        // Sequencing: for each drone, reconvene must be <= next launch
        for (const trips of tripsPerDrone) {
            for (let i = 0; i < trips.length - 1; i++) {
                if (trips[i + 1][0] < trips[i][1]) return false;
            }
        }

        if (!arePartsConsistent(solution, droneMatrix.length)) return false;

        const droneRoutes = getDroneRoutesFromParts(solution);
        const part3Clean = solution.part3.filter(x => x !== -1);
        const part4Clean = solution.part4.filter(x => x !== -1);
        const expectedPairs = part3Clean.length;

        let tripIdx = 0;
        for (let dIdx = 0; dIdx < droneRoutes.length; dIdx++) {
            for (const cust of droneRoutes[dIdx]) {
                if (tripIdx >= expectedPairs) return false;
                const launchCell = parseInt(part3Clean[tripIdx]);
                const reconveneCell = parseInt(part4Clean[tripIdx]);
                if (isNaN(launchCell) || isNaN(reconveneCell)) return false;
                if (!isFeasibleDroneTrip(cust, launchCell, reconveneCell, solution, droneMatrix, flightRange)) {
                    return false;
                }
                tripIdx++;
            }
        }

        if (tripIdx !== expectedPairs) return false;
        return true;
    }

    /**
     * Full validation of a solution string against problem data.
     * Returns { truck_feasible, complete, parts_consistent, drone_trips_ok, feasible, objective }
     */
    function validateSolution(solutionStr, problemData) {
        try {
            const parsed = parseSolution(solutionStr);
            const nNodes = problemData.nCustomers + 1;
            const solution = {
                part1: parsed.truck_route,
                part2: parsed.drone_customers,
                part3: parsed.launch_positions,
                part4: parsed.land_positions,
            };

            const truckFeasible = isTruckRouteFeasible(solution, nNodes);
            const complete = isCompleteSolution(solution, nNodes);
            const partsConsistent = arePartsConsistent(solution, nNodes);
            const droneTripsFeasible = areAllDroneTripsFeasible(
                solution, problemData.droneMatrix, problemData.droneLimit
            );
            const feasible = truckFeasible && complete && partsConsistent && droneTripsFeasible;

            let objective = null;
            if (feasible) {
                try {
                    const result = calculateTotalWaitingTime(solution, problemData);
                    objective = result.totalTime;
                } catch (e) { /* pass */ }
            }

            return {
                truck_feasible: truckFeasible,
                complete,
                parts_consistent: partsConsistent,
                drone_trips_ok: droneTripsFeasible,
                feasible,
                objective,
            };
        } catch (e) {
            return { feasible: false, objective: null, error: e.message };
        }
    }

    // ========================================================================
    // Timing / Objective (port of CalCulateTotalArrivalTime + server override)
    // ========================================================================

    /**
     * Compute total arrival time (objective) — uses the server.py override logic
     * that continues past hover violations instead of aborting early.
     */
    function calculateTotalWaitingTime(solution, problemData) {
        const truckRoute = solution.part1;
        const part2 = solution.part2;
        const part3 = solution.part3;
        const part4 = solution.part4;

        const part3Clean = part3.filter(x => x !== -1).map(Number);
        const part4Clean = part4.filter(x => x !== -1).map(Number);

        // Split drone customers by drone
        const droneRoutes = [];
        let current = [];
        for (const x of part2) {
            if (x === -1) {
                droneRoutes.push(current);
                current = [];
            } else {
                current.push(x);
            }
        }
        droneRoutes.push(current);

        // Map each drone's flights
        const droneFlights = [];
        let startIdx = 0;
        for (const droneCustomers of droneRoutes) {
            const flights = [];
            for (const c of droneCustomers) {
                const launchIdx = part3Clean[startIdx] - 1;
                const returnIdx = part4Clean[startIdx] - 1;
                flights.push([c, launchIdx, returnIdx]);
                startIdx++;
            }
            droneFlights.push(flights);
        }

        let feas = true;
        const tArrival = { [DEPOT_INDEX]: 0 };
        const tDeparture = { [DEPOT_INDEX]: 0 };
        let totalTime = 0;
        const droneAvailability = new Array(droneFlights.length).fill(0);

        for (let i = 1; i < truckRoute.length; i++) {
            const prevNode = truckRoute[i - 1];
            const currNode = truckRoute[i];
            const truckTravel = problemData.truckMatrix[prevNode][currNode];
            const truckArrival = tDeparture[prevNode] + truckTravel;
            tArrival[currNode] = truckArrival;

            const droneReturns = [];
            for (let u = 0; u < droneFlights.length; u++) {
                for (const [cust, launchIdx, returnIdx] of droneFlights[u]) {
                    if (returnIdx !== i) continue;
                    const launchNode = truckRoute[launchIdx];
                    const returnNode = truckRoute[returnIdx];
                    const flightOut = problemData.droneMatrix[launchNode][cust];
                    const flightBack = problemData.droneMatrix[cust][returnNode];
                    const totalFlight = flightOut + flightBack;

                    const actualLaunch = Math.max(tArrival[launchNode], droneAvailability[u]);
                    const droneArrivalCustomer = actualLaunch + flightOut;
                    const droneReturnTime = actualLaunch + totalFlight;
                    droneAvailability[u] = droneReturnTime;
                    droneReturns.push(droneReturnTime);
                    totalTime += droneArrivalCustomer;

                    const droneWait = currNode !== 0
                        ? Math.max(truckArrival - droneReturnTime, 0)
                        : 0;
                    if (totalFlight + droneWait > problemData.droneLimit) {
                        feas = false;
                    }
                }
            }

            if (droneReturns.length > 0) {
                tDeparture[currNode] = Math.max(truckArrival, Math.max(...droneReturns));
            } else {
                tDeparture[currNode] = truckArrival;
            }

            if (currNode !== DEPOT_INDEX) {
                totalTime += truckArrival;
            }
        }

        totalTime /= 100.0;
        return { totalTime, tArrival, tDeparture, feas };
    }

    // ========================================================================
    // Timing Endpoint (port of /api/timing)
    // ========================================================================

    /**
     * Detailed timing analysis for each position in the route.
     */
    function computeTiming(solutionStr, problemData) {
        try {
            const parsed = parseSolution(solutionStr);
            const truckRoute = parsed.truck_route;
            const droneCustomers = parsed.drone_customers;
            const launchPositions = parsed.launch_positions;
            const landPositions = parsed.land_positions;

            const truckMatrix = problemData.truckMatrix;
            const droneMatrix = problemData.droneMatrix;
            const droneLimit = problemData.droneLimit;

            // Build flights by drone
            const sepIdx = droneCustomers.indexOf(-1);
            const effectiveSep = sepIdx === -1 ? droneCustomers.length : sepIdx;
            const droneFlightsMap = { 0: [], 1: [] };

            for (let i = 0; i < droneCustomers.length; i++) {
                const cust = droneCustomers[i];
                if (cust === -1) continue;
                const droneId = i < effectiveSep ? 0 : 1;
                if (i < launchPositions.length && i < landPositions.length) {
                    droneFlightsMap[droneId].push({
                        customer: cust,
                        launch_pos: launchPositions[i],
                        land_pos: landPositions[i],
                    });
                }
            }

            // Walk the truck route
            const timeline = [];
            let truckTime = 0;

            for (let posIdx = 0; posIdx < truckRoute.length; posIdx++) {
                const node = truckRoute[posIdx];
                const pos = posIdx + 1; // 1-based

                const entry = {
                    position: pos,
                    node,
                    truck_arrival: truckTime,
                    truck_departure: truckTime,
                    drone0_launch: false,
                    drone1_launch: false,
                    drone0_landing: false,
                    drone1_landing: false,
                    drone0_arrival: null,
                    drone1_arrival: null,
                    truck_wait_time: 0,
                    drone0_hover_time: 0,
                    drone1_hover_time: 0,
                    served_by: node !== 0 ? 'truck' : 'depot',
                };

                // Drone landings
                for (const droneId of [0, 1]) {
                    for (const flight of droneFlightsMap[droneId]) {
                        if (flight.land_pos !== pos) continue;
                        const launchNode = truckRoute[flight.launch_pos - 1];
                        const outbound = droneMatrix[launchNode][flight.customer];
                        const returnTime = droneMatrix[flight.customer][node];
                        const launchEntryIdx = flight.launch_pos - 1;
                        const droneLaunchTime = launchEntryIdx < timeline.length
                            ? timeline[launchEntryIdx].truck_departure
                            : 0;
                        const droneArrival = droneLaunchTime + outbound + returnTime;

                        entry[`drone${droneId}_landing`] = true;
                        entry[`drone${droneId}_arrival`] = droneArrival;

                        if (droneArrival > truckTime) {
                            entry.truck_wait_time = Math.max(entry.truck_wait_time, droneArrival - truckTime);
                            entry.truck_departure = Math.max(entry.truck_departure, droneArrival);
                        } else {
                            entry[`drone${droneId}_hover_time`] = truckTime - droneArrival;
                        }
                    }
                }

                // Drone launches
                for (const droneId of [0, 1]) {
                    for (const flight of droneFlightsMap[droneId]) {
                        if (flight.launch_pos === pos) {
                            entry[`drone${droneId}_launch`] = true;
                        }
                    }
                }

                timeline.push(entry);

                if (posIdx < truckRoute.length - 1) {
                    truckTime = entry.truck_departure + truckMatrix[node][truckRoute[posIdx + 1]];
                }
            }

            // Flight analysis
            const flightAnalysis = {};
            for (const droneId of [0, 1]) {
                for (const flight of droneFlightsMap[droneId]) {
                    const cust = flight.customer;
                    const launchNode = truckRoute[flight.launch_pos - 1];
                    const landNode = flight.land_pos <= truckRoute.length
                        ? truckRoute[flight.land_pos - 1]
                        : 0;
                    const outbound = droneMatrix[launchNode][cust];
                    const returnTime = droneMatrix[cust][landNode];
                    const total = outbound + returnTime;
                    const launchEntry = flight.launch_pos - 1 < timeline.length
                        ? timeline[flight.launch_pos - 1]
                        : null;
                    const launchTime = launchEntry ? launchEntry.truck_departure : 0;

                    flightAnalysis[cust] = {
                        drone_id: droneId,
                        launch_node: launchNode,
                        land_node: landNode,
                        outbound_time: outbound,
                        return_time: returnTime,
                        total_flight_time: total,
                        max_allowed: droneLimit,
                        margin_remaining: droneLimit - total,
                        utilization_percent: (total / droneLimit) * 100,
                        customer_arrival_time: launchTime + outbound,
                    };
                }
            }

            // Customer arrival times
            const customerArrivals = {};
            for (const entry of timeline) {
                if (entry.node !== 0) {
                    customerArrivals[entry.node] = {
                        arrival_time: entry.truck_arrival,
                        served_by: entry.served_by,
                    };
                }
            }
            for (const [custStr, analysis] of Object.entries(flightAnalysis)) {
                customerArrivals[custStr] = {
                    arrival_time: analysis.customer_arrival_time,
                    served_by: `drone${analysis.drone_id}`,
                };
            }

            // Compute official objective
            let objective = null;
            try {
                const solutionDict = {
                    part1: truckRoute,
                    part2: droneCustomers,
                    part3: launchPositions,
                    part4: landPositions,
                };
                const result = calculateTotalWaitingTime(solutionDict, problemData);
                objective = result.totalTime;
            } catch (e) { /* pass */ }

            return {
                timeline,
                flight_analysis: flightAnalysis,
                customer_arrivals: customerArrivals,
                total_time: timeline.length > 0 ? timeline[timeline.length - 1].truck_arrival : 0,
                objective,
            };
        } catch (e) {
            return { error: e.message };
        }
    }

    // ========================================================================
    // Compare Solutions (port of /api/compare)
    // ========================================================================

    function getCustomerAssignments(parsed, nCustomers) {
        const assignments = {};
        const truckRoute = parsed.truck_route;
        const droneCustomers = parsed.drone_customers;

        for (const node of truckRoute) {
            if (node !== 0) assignments[node] = 'truck';
        }

        const sepIdx = droneCustomers.indexOf(-1);
        const effectiveSep = sepIdx === -1 ? droneCustomers.length : sepIdx;
        for (let i = 0; i < droneCustomers.length; i++) {
            const cust = droneCustomers[i];
            if (cust === -1) continue;
            const droneId = i < effectiveSep ? 0 : 1;
            assignments[cust] = `drone${droneId}`;
        }

        for (let c = 1; c <= nCustomers; c++) {
            if (!(c in assignments)) assignments[c] = 'unassigned';
        }

        return assignments;
    }

    function normalizedEditDistance(routeA, routeB) {
        const a = routeA.filter(x => x !== 0);
        const b = routeB.filter(x => x !== 0);
        if (a.length === 0 && b.length === 0) return 0.0;
        const m = a.length, n = b.length;
        const dp = Array.from({ length: n + 1 }, (_, i) => i);
        for (let i = 1; i <= m; i++) {
            let prev = dp[0];
            dp[0] = i;
            for (let j = 1; j <= n; j++) {
                const temp = dp[j];
                if (a[i - 1] === b[j - 1]) {
                    dp[j] = prev;
                } else {
                    dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
                }
                prev = temp;
            }
        }
        return Math.max(m, n) > 0 ? dp[n] / Math.max(m, n) : 0.0;
    }

    function jaccardSimilarity(setA, setB) {
        if (setA.size === 0 && setB.size === 0) return 1.0;
        let intersection = 0;
        for (const v of setA) {
            if (setB.has(v)) intersection++;
        }
        const union = setA.size + setB.size - intersection;
        return union > 0 ? intersection / union : 1.0;
    }

    /**
     * Compare two solutions.
     */
    function compareSolutions(solAStr, solBStr, nCustomers) {
        try {
            const parsedA = parseSolution(solAStr);
            const parsedB = parseSolution(solBStr);

            const assignA = getCustomerAssignments(parsedA, nCustomers);
            const assignB = getCustomerAssignments(parsedB, nCustomers);

            const perCustomer = [];
            for (let c = 1; c <= nCustomers; c++) {
                perCustomer.push({
                    customer: c,
                    in_a: assignA[c] || 'unassigned',
                    in_b: assignB[c] || 'unassigned',
                });
            }

            // Truck edge sets
            const edgesA = new Set();
            const routeA = parsedA.truck_route;
            for (let i = 0; i < routeA.length - 1; i++) {
                edgesA.add(`${routeA[i]},${routeA[i + 1]}`);
            }

            const edgesB = new Set();
            const routeB = parsedB.truck_route;
            for (let i = 0; i < routeB.length - 1; i++) {
                edgesB.add(`${routeB[i]},${routeB[i + 1]}`);
            }

            const shared = [], onlyA = [], onlyB = [];
            for (const e of edgesA) {
                if (edgesB.has(e)) shared.push(e.split(',').map(Number));
                else onlyA.push(e.split(',').map(Number));
            }
            for (const e of edgesB) {
                if (!edgesA.has(e)) onlyB.push(e.split(',').map(Number));
            }

            // Drone customer sets
            const droneCustsA = new Set();
            for (const [c, v] of Object.entries(assignA)) {
                if (v.startsWith('drone')) droneCustsA.add(parseInt(c));
            }
            const droneCustsB = new Set();
            for (const [c, v] of Object.entries(assignB)) {
                if (v.startsWith('drone')) droneCustsB.add(parseInt(c));
            }

            const editDist = normalizedEditDistance(routeA, routeB);
            const jaccard = jaccardSimilarity(droneCustsA, droneCustsB);
            const composite = 1.0 - (editDist * 0.5 + (1.0 - jaccard) * 0.5);

            return {
                edit_distance: Math.round(editDist * 10000) / 10000,
                jaccard: Math.round(jaccard * 10000) / 10000,
                composite: Math.round(composite * 10000) / 10000,
                per_customer: perCustomer,
                shared_edges: shared,
                only_a_edges: onlyA,
                only_b_edges: onlyB,
            };
        } catch (e) {
            return { error: e.message };
        }
    }

    // ========================================================================
    // Solution Heatmap (port of /api/solution_heatmap)
    // ========================================================================

    /**
     * Compute per-customer assignment fractions across multiple solutions.
     */
    function computeHeatmap(solutionStrings, nCustomers) {
        const counts = {};
        for (let c = 1; c <= nCustomers; c++) {
            counts[c] = { truck: 0, drone0: 0, drone1: 0 };
        }
        let valid = 0;

        for (const solStr of solutionStrings) {
            try {
                const parsed = parseSolution(solStr);
                const assign = getCustomerAssignments(parsed, nCustomers);
                valid++;
                for (let c = 1; c <= nCustomers; c++) {
                    const a = assign[c] || 'unassigned';
                    if (a in counts[c]) {
                        counts[c][a]++;
                    }
                }
            } catch (e) {
                continue;
            }
        }

        if (valid === 0) return { error: 'No valid solutions' };

        const fractions = {};
        for (let c = 1; c <= nCustomers; c++) {
            fractions[String(c)] = {
                truck: Math.round(counts[c].truck / valid * 10000) / 10000,
                drone0: Math.round(counts[c].drone0 / valid * 10000) / 10000,
                drone1: Math.round(counts[c].drone1 / valid * 10000) / 10000,
            };
        }

        return { fractions, n_solutions: valid };
    }

    // ========================================================================
    // Public API
    // ========================================================================

    return {
        parseProblemText,
        classicalMDS,
        computeDroneRangeMds,
        parseSolution,
        validateSolution,
        computeTiming,
        compareSolutions,
        computeHeatmap,
    };
})();
