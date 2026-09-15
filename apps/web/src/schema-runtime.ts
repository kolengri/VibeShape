import { z } from "zod"

// Configure before application schemas initialize: CSP-blocked eval probes are observable in Firefox.
z.config({ jitless: true })
