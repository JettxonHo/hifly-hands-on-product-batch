function requireAdmin(request) {
  if (request.identity?.membership?.role !== "admin") {
    throw Object.assign(new Error("ADMIN_REQUIRED"), { code: "ADMIN_REQUIRED" });
  }
}

export async function registerHiflyProviderRoutes(app, { client }) {
  app.post("/api/providers/hifly/connection-test", async (request) => {
    requireAdmin(request);
    const credit = await client.getAccountCredit();
    return {
      provider: "hifly",
      status: "connected",
      account_credit: { left: credit.left },
      request_id: credit.requestId
    };
  });
}
