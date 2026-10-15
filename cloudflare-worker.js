/**
 * Al-Bahith Al-Thaki — Cloudflare Worker proxy for Shamela Link MCP
 *
 * Configure in Cloudflare Worker Settings > Variables and Secrets:
 *   SHAMELA_AUTHORIZATION (Secret, optional): full Authorization header value,
 *   e.g. "Bearer <token>" ONLY if Shamela Link has issued a valid server-side token.
 *
 * This does not implement OAuth login. Do not invent a token or put credentials
 * in public source code. If the upstream requires interactive OAuth, that flow
 * must be configured separately before searches can work.
 */
const UPSTREAM = "https://shamela.link/mcp";

function corsHeaders(origin) {
  // Public demo frontend. Restrict this to your exact website origin before
  // exposing authenticated endpoints to the public.
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID",
    "Access-Control-Expose-Headers": "MCP-Session-Id, WWW-Authenticate, Content-Type",
    "Vary": "Origin",
  };
}

function withCors(response, origin) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(JSON.stringify({
        service: "Al-Bahith Al-Thaki API",
        status: "worker_running",
        mcp_proxy: "/mcp",
        upstream: UPSTREAM,
        authentication_configured: Boolean(env.SHAMELA_AUTHORIZATION),
        note: "Worker health check only; successful Shamela search requires valid upstream authentication."
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders(origin),
        },
      });
    }

    if (url.pathname !== "/mcp") {
      return new Response(JSON.stringify({ error: "Not found", available: ["/health", "/mcp"] }), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) },
      });
    }

    if (request.method !== "POST" && request.method !== "GET" && request.method !== "DELETE") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) },
      });
    }

    const headers = new Headers();
    for (const name of [
      "Content-Type", "Accept", "MCP-Protocol-Version",
      "MCP-Session-Id", "Last-Event-ID"
    ]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    // Prefer a server-side secret; otherwise forward an Authorization header
    // only for testing. Never place tokens in frontend JavaScript.
    const authorization = env.SHAMELA_AUTHORIZATION || request.headers.get("Authorization");
    if (authorization) headers.set("Authorization", authorization);

    try {
      const upstreamResponse = await fetch(UPSTREAM, {
        method: request.method,
        headers,
        body: request.method === "POST" ? await request.arrayBuffer() : undefined,
        redirect: "manual",
      });
      return withCors(upstreamResponse, origin);
    } catch (error) {
      return new Response(JSON.stringify({
        error: "Could not reach Shamela Link",
        detail: String(error),
      }), {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) },
      });
    }
  },
};
