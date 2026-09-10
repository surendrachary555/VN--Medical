const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders
    }
  });
}

async function makeToken(password) {
  const timestamp = Date.now().toString();
  const data = new TextEncoder().encode(timestamp);
  const keyData = new TextEncoder().encode(password);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, data);

  const bytes = new Uint8Array(signature);
  const signatureText = btoa(String.fromCharCode(...bytes));

  return btoa(timestamp + "." + signatureText);
}

async function verifyToken(token, password) {
  try {
    const decoded = atob(token);
    const [timestamp, signatureText] = decoded.split(".");

    if (!timestamp || !signatureText) return false;

    // Session expires after 8 hours
    if (Date.now() - Number(timestamp) > 8 * 60 * 60 * 1000) {
      return false;
    }

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signatureBytes = Uint8Array.from(
      atob(signatureText),
      c => c.charCodeAt(0)
    );

    return await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(timestamp)
    );
  } catch {
    return false;
  }
}

async function isAdmin(request, env) {
  const auth = request.headers.get("Authorization");

  if (!auth || !auth.startsWith("Bearer ")) {
    return false;
  }

  return verifyToken(
    auth.substring(7),
    env.ADMIN_PASSWORD
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // -------------------------
    // ADMIN LOGIN
    // -------------------------
    if (url.pathname === "/api/admin/login" && request.method === "POST") {
      try {
        const body = await request.json();

        if (!body.password) {
          return json({ error: "Password required" }, 400);
        }

       if (String(body.password).trim() !== String(env.ADMIN_PASSWORD).trim()) {
  return json({
    error: "Invalid password",
    debug: {
      passwordReceived: !!body.password,
      secretConfigured: !!env.ADMIN_PASSWORD
    }
  }, 401);
}

        const token = await makeToken(env.ADMIN_PASSWORD);

        return json({
          success: true,
          token
        });
      } catch {
        return json({ error: "Invalid request" }, 400);
      }
    }

    // -------------------------
    // CUSTOMER MEDICINE SEARCH
    // -------------------------
    if (url.pathname === "/api/medicines" && request.method === "GET") {
      try {
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

        return json(result.results);
      } catch (error) {
        return json({
          error: "Could not load medicines"
        }, 500);
      }
    }

    // -------------------------
    // ADMIN: CREATE MEDICINE
    // -------------------------
    if (url.pathname === "/api/admin/medicines" &&
        request.method === "POST") {

      if (!(await isAdmin(request, env))) {
        return json({ error: "Unauthorized" }, 401);
      }

      try {
        const body = await request.json();

        const quantity = Math.max(
          0,
          Number(body.quantity || 0)
        );

        const availability =
          quantity === 0
            ? "Out of Stock"
            : quantity <= 10
              ? "Limited Stock"
              : "In Stock";

        const result = await env.DB.prepare(`
          INSERT INTO medicines
          (name, price, strength, manufacturer, quantity,
           availability, prescription_required, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).bind(
          body.name,
          Number(body.price || 0),
          body.strength || "",
          body.manufacturer || "",
          quantity,
          availability,
          body.prescription_required || "No"
        ).run();

        return json({
          success: true,
          id: result.meta.last_row_id
        });
      } catch {
        return json({ error: "Could not add medicine" }, 400);
      }
    }

    // -------------------------
    // ADMIN: UPDATE MEDICINE
    // -------------------------
    if (url.pathname === "/api/admin/medicines" &&
        request.method === "PUT") {

      if (!(await isAdmin(request, env))) {
        return json({ error: "Unauthorized" }, 401);
      }

      try {
        const body = await request.json();

        const quantity = Math.max(
          0,
          Number(body.quantity || 0)
        );

        const availability =
          quantity === 0
            ? "Out of Stock"
            : quantity <= 10
              ? "Limited Stock"
              : "In Stock";

        await env.DB.prepare(`
          UPDATE medicines
          SET name = ?,
              price = ?,
              strength = ?,
              manufacturer = ?,
              quantity = ?,
              availability = ?,
              prescription_required = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(
          body.name,
          Number(body.price || 0),
          body.strength || "",
          body.manufacturer || "",
          quantity,
          availability,
          body.prescription_required || "No",
          Number(body.id)
        ).run();

        return json({ success: true });
      } catch {
        return json({ error: "Could not update medicine" }, 400);
      }
    }

    // -------------------------
    // ADMIN: DELETE MEDICINE
    // -------------------------
    if (url.pathname === "/api/admin/medicines" &&
        request.method === "DELETE") {

      if (!(await isAdmin(request, env))) {
        return json({ error: "Unauthorized" }, 401);
      }

      try {
        const id = Number(url.searchParams.get("id"));

        await env.DB.prepare(`
          DELETE FROM medicines WHERE id = ?
        `).bind(id).run();

        return json({ success: true });
      } catch {
        return json({ error: "Could not delete medicine" }, 400);
      }
    }

    // -------------------------
    // HEALTH CHECK
    // -------------------------
    if (url.pathname === "/api/health") {
      try {
        await env.DB.prepare("SELECT 1").first();

        return json({
          ok: true,
          database: "connected"
        });
      } catch {
        return json({
          ok: false,
          database: "error"
        }, 500);
      }
    }

    // Serve the website
    return env.ASSETS.fetch(request);
  }
};
