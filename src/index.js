export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Live medicine search API
    if (url.pathname === "/api/medicines") {
      const search = (url.searchParams.get("search") || "").trim();

      let result;

      if (search) {
        result = await env.DB.prepare(`
          SELECT id, name, price, strength, manufacturer,
                 quantity, availability, prescription_required
          FROM medicines
          WHERE name LIKE ?1
             OR strength LIKE ?1
             OR manufacturer LIKE ?1
          ORDER BY name
        `).bind(`%${search}%`).all();
      } else {
        result = await env.DB.prepare(`
          SELECT id, name, price, strength, manufacturer,
                 quantity, availability, prescription_required
          FROM medicines
          ORDER BY name
        `).all();
      }

      return Response.json(result.results);
    }

    // Database/API health check
    if (url.pathname === "/api/health") {
      try {
        await env.DB.prepare("SELECT 1").first();

        return Response.json({
          ok: true,
          database: "connected"
        });
      } catch (error) {
        return Response.json({
          ok: false,
          database: "error"
        }, { status: 500 });
      }
    }

    // Serve the existing VN Medical website
    return env.ASSETS.fetch(request);
  }
};
