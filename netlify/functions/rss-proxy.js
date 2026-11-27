const headers = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};

export async function handler() {
  const targetUrl = "https://visiteskilstuna.se/rest-api/rssService/getRssFeed?portletId=12.5b899160171ac5273c72ad9f&pageId=2.369be3c31580a19562d1977e&t=" + Date.now();

  try {
    const response = await fetch(targetUrl, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`RSS-källan svarade med HTTP ${response.status}.`);

    return {
      statusCode: 200,
      headers: {
        ...headers,
        "Content-Type": "text/xml; charset=utf-8",
      },
      body: await response.text(),
    };
  } catch (error) {
    console.error("Kunde inte hämta RSS-flödet från källan.", error);
    return {
      statusCode: 502,
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
      body: "Kunde inte hämta RSS-flödet.",
    };
  }
}
