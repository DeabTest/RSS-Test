export async function handler(event, context) {
  const targetUrl = "https://visiteskilstuna.se/rest-api/rssService/getRssFeed?portletId=12.5b899160171ac5273c72ad9f&pageId=2.369be3c31580a19562d1977e&t=" + Date.now();

  try {
    const response = await fetch(targetUrl);
    const data = await response.text();

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/xml",
      },
      body: data,
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: "Kunde inte hämta RSS-flödet.",
    };
  }
}
