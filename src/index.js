export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Medicine search API
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

    // Health check
    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        database: "connected"
      });
    }

    return new Response("VN Medical API is running");
  }
};
