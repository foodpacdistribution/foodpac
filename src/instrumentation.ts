import type { Instrumentation } from "next";

const AREA = { render: "Page", route: "API", action: "Action", proxy: "Proxy" } as const;

/** Errors no page or action caught: emailed to the office (see lib/report-error). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("./lib/report-error");
  // The path only, without the query string (it can hold search terms or tokens).
  await reportError(err, { area: AREA[context.routeType] ?? context.routeType, path: `${request.method} ${request.path.split("?")[0]}` });
};
