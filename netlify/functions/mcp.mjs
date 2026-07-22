import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { fetchEvents } from "./event-service.mjs";

function createServer() {
  const server = new McpServer(
    { name: "eskilstuna-evenemang", version: "1.0.0" },
    {
      instructions:
        "Hämta ett komplett och aktuellt evenemangsunderlag med hamta_evenemang. Använd aldrig ett resultat där complete är false som redaktionellt underlag.",
    },
  );

  server.registerTool(
    "hamta_evenemang",
    {
      title: "Hämta evenemang i Eskilstuna",
      description:
        "Hämtar färska evenemang från Eskilstunas Evenemangsguide för ett datumintervall. Använd verktyget för aktuella evenemangsurval, säsongsartiklar, nyhetsbrev och sociala medier. Resultatet är komplett endast när complete är true.",
      inputSchema: {
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Startdatum i formatet YYYY-MM-DD"),
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Slutdatum i formatet YYYY-MM-DD"),
        category: z.string().min(1).optional().describe("Exakt kategorinamn för API-filtrering"),
        area: z.string().min(1).optional().describe("Exakt områdesnamn för API-filtrering"),
        query: z.string().optional().describe("Valfritt sökord som skickas till API:t"),
        include_recurring: z.boolean().default(false).describe("Ta med återkommande småaktiviteter"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      if (input.start > input.end) {
        return {
          isError: true,
          content: [{ type: "text", text: "Startdatum kan inte vara efter slutdatum." }],
        };
      }
      const result = await fetchEvents(input);
      return {
        isError: !result.complete,
        structuredContent: result,
        content: [{
          type: "text",
          text: result.complete
            ? `Hämtningen är komplett. ${result.meta.returned} evenemang returnerades för perioden ${input.start} till ${input.end}.`
            : result.error,
        }],
      };
    },
  );
  return server;
}

export default async function handler(request) {
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export const config = { path: "/mcp" };

