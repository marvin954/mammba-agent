export async function GET(request: Request) {
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader) {
    return new Response("Unauthorized", {
      status: 401,
    });
  }

  // Put your scheduled work here

  console.log("Cron executed");

  return Response.json({
    success: true,
    timestamp: new Date().toISOString(),
  });
}