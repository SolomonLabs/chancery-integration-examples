import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT_SOURCE = process.env.PORT ?? "4173";
const PORT = Number(PORT_SOURCE);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("PORT must be an integer from 1 through 65535");
}

const CONTENT_TYPES = new Map([
    [".css", "text/css; charset=utf-8"],
    [".html", "text/html; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".mjs", "text/javascript; charset=utf-8"],
]);

function responseHeaders(filePath) {
    return {
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
        "Content-Type": CONTENT_TYPES.get(path.extname(filePath)) ?? "application/octet-stream",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
    };
}

function resolveRequestPath(requestUrl) {
    const url = new URL(requestUrl ?? "/", "http://localhost");
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = path.resolve(ROOT_DIRECTORY, "." + pathname);
    const allowedPrefix = ROOT_DIRECTORY + path.sep;
    if (filePath !== ROOT_DIRECTORY && !filePath.startsWith(allowedPrefix)) {
        throw new Error("Request path escapes the application directory");
    }
    return filePath;
}

const server = createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end("Method not allowed\n");
        return;
    }
    try {
        const filePath = resolveRequestPath(request.url);
        const bytes = await readFile(filePath);
        response.writeHead(200, responseHeaders(filePath));
        response.end(request.method === "HEAD" ? undefined : bytes);
    } catch (error) {
        const statusCode = error instanceof URIError ? 400 : 404;
        response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(statusCode === 400 ? "Invalid request path\n" : "Not found\n");
    }
});

server.listen(PORT, HOST, () => {
    process.stdout.write("Chancery instruction builder: http://" + HOST + ":" + String(PORT) + "\n");
});
