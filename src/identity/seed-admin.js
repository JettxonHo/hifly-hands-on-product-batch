import { randomUUID } from "node:crypto";

import { hashPassword } from "./password.js";

function invalid(code) {
  return Object.assign(new Error(code), { code });
}

export async function seedInitialAdmin(repository, config, { now = Date.now } = {}) {
  const { organizationId, organizationName, adminEmail, adminDisplayName, adminTempPassword } = config ?? {};
  if (!organizationId || !adminEmail || !adminTempPassword) throw invalid("SEED_CONFIG_INCOMPLETE");
  if (/CHANGE_ME/i.test(adminTempPassword)) throw invalid("SEED_PLACEHOLDER_PASSWORD_FORBIDDEN");
  const at = new Date(now()).toISOString();
  return repository.seedInitialAdmin({
    organization_id: organizationId,
    organization_name: organizationName || "Enterprise",
    member_id: `member_${randomUUID()}`,
    membership_id: `membership_${randomUUID()}`,
    credential_id: `credential_${randomUUID()}`,
    email: adminEmail.trim().toLowerCase(),
    display_name: adminDisplayName || adminEmail,
    password_hash: await hashPassword(adminTempPassword),
    at,
    event: {
      type: "identity.admin_seeded",
      organization_id: organizationId,
      outcome: "success",
      at,
      meta: { source: "deployment_seed" }
    }
  });
}
